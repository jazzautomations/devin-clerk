"""Testes do scraper — pytest (ou asserts puros sem pytest).

Uso:
  DATABASE_URL=postgres://…dev uv run --python .venv-scraper/bin/python -m pytest scripts/test_scrape_radar.py
  npm run test:scrape
Os testes de banco criam um schema descartável e apagam no fim; sem
DATABASE_URL eles são pulados. Fixtures reais em scripts/fixtures/radar.
"""

import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape_radar as sr  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


FIX = Path(__file__).resolve().parent / "fixtures" / "radar"


def _db():
    """Schema descartável num Postgres real (DATABASE_URL), com as migrations
    do app aplicadas — o scraper testa contra o mesmo schema de produção."""
    import psycopg
    if not os.environ.get("DATABASE_URL"):
        import pytest
        pytest.skip("sem DATABASE_URL")
    raw = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
    schema = f"t_{uuid.uuid4().hex[:10]}"
    raw.execute(f"CREATE SCHEMA {schema}")
    raw.execute(f"SET search_path TO {schema}")
    _SCHEMAS.append((raw, schema))
    for f in sorted(MIGRATIONS.glob("*.sql")):
        raw.execute(f.read_text())
    return sr.PgConn(raw)


_SCHEMAS: list = []


def _drop_schemas():
    while _SCHEMAS:
        raw, schema = _SCHEMAS.pop()
        raw.execute(f"DROP SCHEMA {schema} CASCADE")
        raw.close()


def teardown_function(_fn):  # pytest: cada teste limpa o schema dele
    _drop_schemas()


def _row(**kw):
    base = {
        "id": "x-1",
        "name": "Evento",
        "organizer": "Org",
        "startsAt": "2999-01-01T09:00:00",
        "endsAt": "2999-01-02T18:00:00",
        "format": "online",
        "location": None,
        "registrationUrl": "https://x.dev/ev",
        "registrationDeadline": None,
        "tags": [],
        "source": "devpost",
    }
    base.update(kw)
    return base


def test_dedupe_merges_cross_source():
    rows = [
        _row(id="devpost-1", name="Hackathon X", endsAt=None, tags=[]),
        _row(
            id="taikai-abc",
            name="  HACKATHON   X ",
            source="taikai",
            location="Lisboa",
            registrationDeadline="2999-01-01T00:00:00",
            tags=["web3"],
        ),
        _row(id="devpost-2", name="Outro Hackathon"),
    ]
    winners, merges = sr.dedupe(rows)
    assert merges == 1, merges
    assert len(winners) == 2, winners
    w = next(w for w in winners if w["source"] == "devpost+taikai")
    # ficha mais rica (taikai: endsAt+location+deadline+tags) vence e mantém o id dela
    assert w["id"] == "taikai-abc", w
    assert w["location"] == "Lisboa"
    assert "web3" in w["tags"]


def test_dedupe_same_name_diff_date_kept():
    rows = [
        _row(id="a", name="Hack Sampa", startsAt="2026-03-01T09:00:00"),
        _row(id="b", name="hack sampa", startsAt="2026-10-01T09:00:00"),
    ]
    winners, merges = sr.dedupe(rows)
    assert merges == 0 and len(winners) == 2  # edições distintas


def test_dedupe_empty_fill():
    # vencedor sem endsAt herda do perdedor
    rows = [
        _row(id="rich", name="Mega Hack", endsAt="2999-01-05T00:00:00",
             location="SP", tags=["ia"], registrationDeadline="2999-01-01"),
        _row(id="poor", name="mega  hack", endsAt=None, location=None,
             tags=[], organizer=None),
    ]
    winners, _ = sr.dedupe(rows)
    assert len(winners) == 1
    assert winners[0]["id"] == "rich"


def test_is_hackathon():
    assert not sr.is_hackathon("DevOps Summit 2026")
    assert not sr.is_hackathon("Meetup de dados")
    assert not sr.is_hackathon("Webinar de carreiras")
    assert not sr.is_hackathon("Workshop de vendas")
    assert not sr.is_hackathon("Feira de profissões")
    assert not sr.is_hackathon("Congresso Brasileiro de TI")
    assert not sr.is_hackathon("Global Pizza Party NYC")
    assert sr.is_hackathon("Hackathon X")
    assert sr.is_hackathon("HackaSanta — Saúde")
    assert sr.is_hackathon("Data Summit — Hackathon oficial")  # hack vence deny
    assert sr.is_hackathon("NASA Space Apps Challenge")        # neutro passa
    assert sr.is_hackathon("ETHGlobal Mumbai")                 # neutro passa
    assert sr.is_hackathon("Maratona Buildathon BR")
    assert sr.is_hackathon("TechConf 2026", tags=["hackathon"])  # tag salva


def test_upsert_expiration_and_timestamps():
    conn = _db()
    sr.ensure_schema(conn)
    past = _row(id="p1", startsAt="2020-01-01T09:00:00",
                endsAt="2020-01-02T18:00:00")
    fut = _row(id="f1")
    n = sr.upsert(conn, [past, fut])
    assert n == 2
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='p1'").fetchone()[0] == 0
    row = conn.execute(
        "SELECT active, first_seen, last_seen FROM hackathons WHERE id='f1'"
    ).fetchone()
    assert row[0] == 1 and row[1] and row[2]

    # re-upsert: first_seen preservado
    first = row[1]
    sr.upsert(conn, [_row(id="f1", name="Evento Renomeado")])
    row2 = conn.execute(
        "SELECT first_seen, name FROM hackathons WHERE id='f1'").fetchone()
    assert row2[0] == first and row2[1] == "Evento Renomeado"

    # sweep desativa externo expirado que voltou a active=1, poupa comunidade
    conn.execute("UPDATE hackathons SET active=1 WHERE id='p1'")
    conn.execute(
        "INSERT INTO hackathons (id, name, organizer, startsAt, format,"
        " registrationUrl, active) VALUES ('com1','Comunidade Velha','Casa',"
        " '2020-01-01T09:00:00','presencial','https://x.dev',1)")
    assert sr.sweep_expired(conn) == 1
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='p1'").fetchone()[0] == 0
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='com1'").fetchone()[0] == 1


def test_community_key_blocks_scraped():
    conn = _db()
    sr.ensure_schema(conn)
    conn.execute(
        "INSERT INTO hackathons (id, name, organizer, startsAt, format,"
        " registrationUrl, active) VALUES ('com2','Hack COMS','Casa',"
        " '2026-11-07T09:00:00-05:00','presencial','https://x.dev',1)")
    scraped = _row(id="mlh-9", name="hack   coms",
                   startsAt="2026-11-07T14:00:00Z", source="mlh")
    kept, skipped = sr.filter_vs_existing(conn, [scraped])
    assert kept == [] and len(skipped) == 1


def test_stale_dupe_deactivated():
    conn = _db()
    sr.ensure_schema(conn)
    # rodada antiga inseriu meetup-7; nova rodada trouxe o mesmo evento via devpost
    sr.upsert(conn, [_row(id="meetup-7", name="Hack X", source="meetup")])
    winners, _ = sr.dedupe([_row(id="devpost-9", name="hack x")])
    sr.upsert(conn, winners)
    assert sr.deactivate_stale_dupes(conn, winners) == 1
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='meetup-7'").fetchone()[0] == 0
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='devpost-9'").fetchone()[0] == 1


def test_prize_display_devpost():
    """prize_amount vem com HTML embutido; '$0'/vazio não é argumento de venda."""
    assert sr.prize_display(
        "$<span data-currency-value>138,000</span>") == "$138,000"
    assert sr.prize_display(
        "₹ <span data-currency-value>100,000</span>") == "₹ 100,000"
    assert sr.prize_display(None) is None
    assert sr.prize_display("") is None
    assert sr.prize_display("$<span data-currency-value>0</span>") is None


def test_taikai_prize_display():
    """prize int + prizeCurrency.name → display com símbolo da moeda."""
    assert sr.taikai_prize(20000, "EUR") == "€20,000"
    assert sr.taikai_prize(3500, "USD") == "$3,500"
    assert sr.taikai_prize(15000, "BRL") == "R$ 15.000"  # real no formato BR
    assert sr.taikai_prize(0, "EUR") is None
    assert sr.taikai_prize(None, "EUR") is None
    # moeda fora do mapa cai pro código — nunca inventa símbolo
    assert sr.taikai_prize(1000, "XYZ") == "XYZ 1,000"


def test_dedupe_prefers_row_with_prize():
    """prêmio pesa no metadata_score — ficha com prize vence o empate."""
    winners, _ = sr.dedupe([
        _row(id="a", name="Hack P"),
        _row(id="b", name="hack  p", prize="$5,000"),
    ])
    assert len(winners) == 1
    assert winners[0]["id"] == "b"
    assert winners[0]["prize"] == "$5,000"


def test_dedupe_fills_prize_from_loser():
    """vencedor sem prêmio herda o do perdedor (fill de campo vazio)."""
    rows = [
        _row(id="rich", name="Hack Prize", location="SP", tags=["a", "b"]),
        _row(id="poor", name="hack  prize", prize="$10,000"),
    ]
    winners, _ = sr.dedupe(rows)
    assert len(winners) == 1
    assert winners[0]["id"] == "rich"
    assert winners[0]["prize"] == "$10,000"


def test_upsert_stores_prize():
    conn = _db()
    sr.ensure_schema(conn)
    sr.upsert(conn, [_row(id="pz", prize="$10,000")])
    assert conn.execute(
        "SELECT prize FROM hackathons WHERE id='pz'"
    ).fetchone()[0] == "$10,000"
    # re-upsert atualiza — e limpa quando a fonte some com o prêmio
    sr.upsert(conn, [_row(id="pz", prize="$20,000")])
    assert conn.execute(
        "SELECT prize FROM hackathons WHERE id='pz'"
    ).fetchone()[0] == "$20,000"
    sr.upsert(conn, [_row(id="pz", prize=None)])
    assert conn.execute(
        "SELECT prize FROM hackathons WHERE id='pz'"
    ).fetchone()[0] is None


def test_ethglobal_fixture():
    """Payload real do Next na /events (reduzido): só hackathon futuro."""
    html = (FIX / "ethglobal_events.html").read_text()
    out = sr.parse_ethglobal(html, now=NOW_FIX)
    assert [e["name"] for e in out] == ["ETHGlobal Mumbai"], out
    e = out[0]
    assert e["format"] == "presencial"
    assert e["location"] == "Mumbai, Índia"
    assert e["registrationDeadline"].startswith("2026-11-03")
    assert e["registrationUrl"] == "https://ethglobal.com/events/mumbai"
    assert sr.fill_reach(dict(e))["scope"] == "cidade"


def test_is_expired_coalesce_boundary():
    """spec 027 — expiração usa COALESCE(endsAt, registrationDeadline,
    startsAt): evento cuja janela abriu mas não fechou (Devpost) NÃO expira."""
    from datetime import datetime, timezone
    now = datetime(2026, 10, 2, tzinfo=timezone.utc)
    # ongoing: startsAt passado + endsAt futuro → aberto
    assert not sr.is_expired(_row(
        startsAt="2026-09-20T09:00:00", endsAt="2026-10-05T18:00:00"), now)
    # sem endsAt, registrationDeadline futuro segura o evento
    assert not sr.is_expired(_row(
        startsAt="2026-09-20T09:00:00", endsAt=None,
        registrationDeadline="2026-10-10T00:00:00"), now)
    # endsAt passado vence deadline futuro — evento acabou é arquivo
    assert sr.is_expired(_row(
        startsAt="2026-09-20T09:00:00", endsAt="2026-09-25T18:00:00",
        registrationDeadline="2026-10-10T00:00:00"), now)
    # sem nenhuma data de fim, start passado → expirado
    assert sr.is_expired(_row(
        startsAt="2026-09-20T09:00:00", endsAt=None,
        registrationDeadline=None), now)
    # futuro segue aberto
    assert not sr.is_expired(_row(), now)


def test_sweep_respects_registration_deadline():
    """spec 027 — o varredor usa a mesma COALESCE do radar: deadline de
    inscrição futuro protege evento com startsAt passado."""
    conn = _db()
    sr.ensure_schema(conn)
    conn.execute(
        "INSERT INTO hackathons (id, name, organizer, startsAt, endsAt,"
        " format, registrationUrl, registrationDeadline, active, source)"
        " VALUES ('reg-open','Hack Deadline Aberta','Org',"
        " '2020-01-01T09:00:00', NULL, 'online', 'https://x.dev',"
        " '2999-01-01T00:00:00', 1, 'devpost')")
    conn.execute(
        "INSERT INTO hackathons (id, name, organizer, startsAt, endsAt,"
        " format, registrationUrl, registrationDeadline, active, source)"
        " VALUES ('all-past','Hack Velha','Org',"
        " '2020-01-01T09:00:00', NULL, 'online', 'https://x.dev',"
        " '2020-02-01T00:00:00', 1, 'devpost')")
    assert sr.sweep_expired(conn) == 1
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='reg-open'").fetchone()[0] == 1
    assert conn.execute(
        "SELECT active FROM hackathons WHERE id='all-past'").fetchone()[0] == 0


# ---------- classificação com casos reais (prod, 14/10/2026) ----------

MEETUP_LIXO = [
    "Retrospectiva do Grupo: o que construímos até aqui",
    "21º Meet Up: Introdução à linguagem Latex",
    "30º BitDevs BH",
    "Front @ Uber 2026",
    "Azure Databricks Day - GenAI, Python, Delta, Spark, ML",
    "Construindo Workflows Reutilizáveis no VS Code",
    "LFDT Mentorship: Talent Angels - Pilot Project",
    "ZK Learning Group: Quantum resistance and ZKP",
    "HandsOn AI",
    "Introdução a Cloud AWS",
    "Golang SP & Sigma Software (APENAS PARA MULHERES - ADA",
]


def test_meetup_so_entra_hackathon():
    for name in MEETUP_LIXO:
        assert sr.classify(_row(name=name, source="meetup")) == \
            "nao-hackathon", name
    assert sr.classify(_row(name="Hackathon de IA da comunidade",
                            source="meetup")) is None
    # nome neutro, mas a descrição diz que é hackathon
    assert sr.classify(_row(name="Desafio Open Finance", source="meetup"),
                       "Hackathon de 48h com equipes e entrega de protótipo"
                       ) is None
    # descrição de hackathon não salva palestra
    assert sr.classify(_row(name="Palestra sobre carreira", source="meetup"),
                       "dicas pra quem vai a um hackathon") == "nao-hackathon"


def test_termos_de_hackathon_brasileiros():
    for name in [
        "Hackathon Cidades Sábias",
        "Hackaton: Cocriando o Futuro da Nossa Cidade",
        "HackathOrion 2026 - Outubro",
        "Hack 4 Fun 2026 - Soluções para enfrentar o El Niño",
        "Game Jam Plus 2026/2027 — Criações Goianas",
        "Gamejam+ Amazonas, Aperte o Play!",
        "NASA Space Apps Challenge Goiânia",
        "Maratona de Inovação • Acelera Perifa",
        "Maratona de Programação SBC — Fase Regional",
        "Datathon Saúde Pública",
        "Ideathon Sebrae",
        "Desafio de Inovação Aberta TJPA",
    ]:
        assert sr.classify(_row(name=name, source="sympla")) is None, name


def test_evento_sobre_hackathon_nao_e_hackathon():
    for name in [
        "Abertura da Game Jam Plus 2026/27 (DJUFF x ACJOGOS-RJ)",
        "Workshop preparatório para o Hackathon X",
        "Mentoria: como vencer um hackathon",
        "Inscrição para Mentores do Hackathon Regional Inova Agro MS",
        "Bootcamp Design Systems Avançados 2.0 com AI (Outubro)",
        "CONEXÃO UNIVERSO",
        "AKCIT Camp - Online",
    ]:
        assert sr.classify(_row(name=name, source="sympla")) == \
            "nao-hackathon", name
    assert sr.classify(_row(name="Learn to Hack: MATLAB Edition 2026",
                            source="devpost")) == "nao-hackathon"
    # summit com hackathon dentro continua valendo
    assert sr.classify(_row(name="Data Summit — Hackathon oficial",
                            source="meetup")) is None


def test_devpost_tira_o_lixo():
    ok = dict(source="devpost", registrations=300)
    few = dict(source="devpost", registrations=40)
    assert sr.classify(_row(name="2026-2027 Fall ESE Senior Design",
                            organizer="university of pennsylvania", **ok)
                       ) == "disciplina"
    # prêmio irrisório só derruba quando quase ninguém se inscreveu
    assert sr.classify(_row(name="Pumpkin Playground", organizer="ACM",
                            prize="$30", **few)) == "premio-irrisorio"
    assert sr.classify(_row(name="InternWell Hack2.0", organizer="SLIET",
                            prize="₹ 1,000", **few)) == "premio-irrisorio"
    assert sr.classify(_row(name="Next Byte Hacks V5", organizer="NBH",
                            prize="$100", **ok)) is None  # 300 inscritos
    assert sr.classify(_row(name="Code for Humanity", organizer="nill",
                            **ok)) == "organizador-vazio"
    assert sr.classify(_row(name="Ghost Hack", organizer="Org",
                            source="devpost", registrations=3)
                       ) == "sem-inscritos"
    # em breve, com prêmio, ainda sem inscrito: fica
    assert sr.classify(_row(name="Ghost Hack", organizer="Org", prize="$5,000",
                            source="devpost", registrations=3)) is None
    # só pra membros de um clube/faculdade
    assert sr.classify(_row(name="AI Lodge Hackathon 2026", organizer="SMU",
                            restrictedTo="SMU BIA members", **ok)
                       ) == "publico-restrito"
    # o que é bom fica
    assert sr.classify(_row(name="PayPal AI Hackathon", organizer="PayPal",
                            prize="$67,500", **ok)) is None
    assert sr.classify(_row(name="Syntax Summit", organizer="Student Org",
                            **ok)) is None  # Devpost só lista hackathon
    assert sr.classify(_row(name="Next Founders Hackathon", organizer="SO",
                            prize="$275", **ok)) is None
    assert sr.classify(_row(name="CodeSprint by Elite Coders",
                            organizer="elite coders", prize="₹ 30,000", **ok)
                       ) is None  # ~US$ 360


def test_curadoria_nao_passa_pelo_filtro():
    assert sr.classify(_row(name="Encontro qualquer", source="curadoria")) \
        is None


def test_prize_usd():
    assert sr.prize_usd("$30") == 30
    assert sr.prize_usd("$138,000") == 138000
    assert round(sr.prize_usd("₹ 1,000")) == 12
    assert round(sr.prize_usd("R$ 15 mil")) == 2700
    assert round(sr.prize_usd("€10,680")) == 11748
    assert sr.prize_usd(None) is None
    assert sr.prize_usd("muitos prêmios") is None


# ---------- região ----------

def test_region_de_cada_evento():
    reg = lambda **kw: sr.region_of(_row(**kw))  # noqa: E731
    assert reg(format="presencial", location="Belém, PA",
               source="curadoria") == "br"
    assert reg(format="hibrido", location="Santa Casa, São Paulo",
               source="curadoria") == "br"
    assert reg(format="presencial", location="ParkShoppingCanoas, Canoas, RS",
               source="sympla") == "br"
    assert reg(format="presencial", location="Mumbai, Índia",
               source="curadoria") == "exterior"
    assert reg(format="presencial", location="Washington DC",
               source="devpost") == "exterior"
    assert reg(format="presencial", location="jaipur",
               source="devpost") == "exterior"
    # online: fonte brasileira, português ou prêmio em real
    assert reg(format="online", source="sympla",
               name="Engenharia de Software") == "online-br"
    assert reg(format="online", source="taikai",
               name="Desafio de Inovação Aberta") == "online-br"
    assert reg(format="online", source="taikai", name="Web3 Builders",
               prize="R$ 15.000") == "online-br"
    assert reg(format="online", source="devpost",
               name="PayPal AI Hackathon") == "online-mundo"
    # espanhol não é português
    assert reg(format="online", source="devpost",
               name="Hackathon Agéntico SoftwareChido 2026B") == "online-mundo"


def test_upsert_grava_region_e_exclui_recusado():
    conn = _db()
    sr.ensure_schema(conn)
    sr.upsert(conn, [
        _row(id="sympla-1", name="Hackathon Cidades Sábias",
             format="presencial", location="Canoas, RS", source="sympla"),
        _row(id="meetup-9", name="Hack velho que virou palestra",
             source="meetup"),
    ])
    assert conn.execute("SELECT region FROM hackathons WHERE id='sympla-1'"
                        ).fetchone()[0] == "br"
    n = sr.exclude_rejected(conn, [(_row(id="meetup-9"), "nao-hackathon")])
    assert n == 1
    assert conn.execute(
        "SELECT active, \"excludedReason\" FROM hackathons WHERE id='meetup-9'"
    ).fetchone() == (0, "nao-hackathon")
    # voltou a passar no filtro → upsert reativa e limpa o motivo
    sr.upsert(conn, [_row(id="meetup-9", name="Hackathon de verdade",
                          source="meetup")])
    assert conn.execute(
        "SELECT active, \"excludedReason\" FROM hackathons WHERE id='meetup-9'"
    ).fetchone() == (1, None)


def test_reclassify_existing_desliga_lixo_antigo_e_poupa_casa():
    conn = _db()
    sr.ensure_schema(conn)
    sr.upsert(conn, [
        _row(id="meetup-1", name="30º BitDevs BH", source="meetup",
             format="presencial", location="Belo Horizonte"),
        _row(id="devpost-1", name="Pumpkin Playground", prize="$30",
             organizer="ACM"),
        _row(id="devpost-2", name="PayPal AI Hackathon", prize="$67,500",
             organizer="PayPal"),
        _row(id="comu-1", name="Encontro da comunidade", source="comunidade"),
    ])
    conn.execute("UPDATE hackathons SET region=NULL WHERE id='devpost-2'")
    # linhas de rodadas anteriores (o que a rodada de hoje viu não é
    # reclassificado: o banco não guarda inscritos)
    conn.execute("UPDATE hackathons SET last_seen='2026-01-01T00:00:00+00:00'")
    off, filled = sr.reclassify_existing(conn)
    assert off == 2
    act = dict(conn.execute("SELECT id, active FROM hackathons").fetchall())
    assert act == {"meetup-1": 0, "devpost-1": 0, "devpost-2": 1, "comu-1": 1}
    assert filled == 1
    assert conn.execute("SELECT region FROM hackathons WHERE id='devpost-2'"
                        ).fetchone()[0] == "online-mundo"


def test_migration_023_desativa_meetup_e_disciplina():
    """A migration roda de novo aqui sobre linhas antigas: o que não é
    hackathon sai do ar com motivo, sem DELETE."""
    conn = _db()
    for i, (src, name) in enumerate([
        ("meetup", "Retrospectiva do Grupo: o que construímos até aqui"),
        ("meetup", "Hackathon Comunidade Rio"),
        ("devpost", "2026-2027 Fall ESE Senior Design"),
        ("devpost", "PayPal AI Hackathon"),
    ]):
        conn.execute(
            "INSERT INTO hackathons (id, name, organizer, startsAt, format,"
            " registrationUrl, active, source) VALUES"
            " (?, ?, 'Org', '2999-01-01', 'online', 'https://x.dev', 1, ?)",
            (f"m{i}", name, src))
    sql = (MIGRATIONS / "023_radar_brasil.sql").read_text()
    data_sql = sql.split("ADD COLUMN \"excludedReason\" TEXT;", 1)[1]
    conn.conn.execute(data_sql)
    rows = dict(conn.execute(
        "SELECT id, active FROM hackathons WHERE id LIKE 'm%'").fetchall())
    assert rows == {"m0": 0, "m1": 1, "m2": 0, "m3": 1}
    assert conn.execute("SELECT COUNT(*) FROM hackathons WHERE id LIKE 'm%'"
                        ).fetchone()[0] == 4


# ---------- fontes brasileiras (fixtures reais) ----------

NOW_FIX = sr.datetime(2026, 10, 14, 12, 0, tzinfo=sr.timezone.utc)


def test_parse_pt_dates():
    assert sr.parse_pt_dates("Sábado, 31 de Out às 16:00", NOW_FIX) == (
        "2026-10-31T16:00:00-03:00", "2026-10-31T23:59:00-03:00")
    assert sr.parse_pt_dates("06 de Out a 16 de Nov", NOW_FIX) == (
        "2026-10-06T09:00:00-03:00", "2026-11-16T18:00:00-03:00")
    # virada de ano: dezembro → janeiro
    assert sr.parse_pt_dates("28 de Dez a 03 de Jan", NOW_FIX)[1] == \
        "2027-01-03T18:00:00-03:00"
    # mês que passou há muito é do ano que vem
    assert sr.parse_pt_dates("18 de Jan a 26 de Jan", NOW_FIX)[0] == \
        "2027-01-18T09:00:00-03:00"
    assert sr.parse_pt_dates("21 de out. de 2026", NOW_FIX)[0] == \
        "2026-10-21T09:00:00-03:00"
    assert sr.parse_pt_dates("sem data", NOW_FIX) == (None, None)


def test_sympla_fixture():
    md = (FIX / "sympla_busca_hackathon.md").read_text()
    rows = sr.parse_sympla_md(md, NOW_FIX)
    assert len(rows) == 24, len(rows)
    by = {r["name"]: r for r in rows}
    h = by["Hackathon Cidades Sábias"]
    assert h["location"] == "ParkShoppingCanoas, Canoas, RS"
    assert h["format"] == "presencial"
    assert h["startsAt"].startswith("2026-10-06")
    assert h["endsAt"].startswith("2026-11-16")
    assert h["registrationUrl"] == \
        "https://www.sympla.com.br/evento/hackathon-cidades-sabias/3608159"
    # imagem reaproveitada de outro evento: o nome sai do slug
    assert "Hackathon Unimed Uberlândia 2026" in by
    assert by["Hackathon Unimed Uberlândia 2026"]["location"].endswith(
        "Uberlândia, MG")
    # online
    assert by["AKCIT Camp - Online"]["format"] == "online"
    # passa no classificador só o que é hackathon
    kept = [r["name"] for r in rows if sr.classify(r) is None]
    assert "Hackathon Cidades Sábias" in kept
    assert "Game Jam Plus 2026/2027 — Criações Goianas" in kept
    assert "NASA Space Apps Challenge Goiânia" in kept
    for lixo in ("CONEXÃO UNIVERSO",
                 "POSTGRESQL MOTHERFUCKER ADVANCED",
                 "Abertura da Game Jam Plus 2026/27 (DJUFF x ACJOGOS-RJ)"):
        assert lixo not in kept, lixo
    assert all(sr.region_of(r) == "br" for r in rows
               if r["format"] == "presencial")


def test_doity_fixture():
    cards = sr.parse_doity_cards(
        (FIX / "doity_busca_inovacao.html").read_text())
    assert len(cards) >= 10
    c = next(c for c in cards if "Acelera Perifa" in c["title"])
    assert c["url"] == "https://doity.com.br/maratona-de-inovacao-acelera-perifa"
    assert c["meta"] == "21 de out. de 2026 · Maceió, AL"
    hack = [c["title"] for c in cards if sr.HACK_RE.search(c["title"])]
    assert hack == ["Maratona de Inovação • Acelera Perifa"], hack
    ev = sr.parse_doity_event((FIX / "doity_evento_maratona.html").read_text())
    assert ev["name"] == "Maratona de Inovação • Acelera Perifa"
    assert ev["startsAt"] == "2026-10-21T13:00:00-03:00"
    assert ev["endsAt"] == "2026-10-22T17:00:00-03:00"
    assert ev["format"] == "presencial"
    assert ev["location"].endswith("Maceió, AL")
    assert ev["organizer"].startswith("Liinc")
    assert "Maratona de Inovação" in ev["description"]


def test_house_sources_untouched():
    """Edições da casa (source NULL, 'seed' do seed, 'painel' do painel)
    ficam no ar depois de acabar e bloqueiam raspado com a mesma chave.
    Evento de terceiro posto à mão ('admin') e indicação ('comunidade')
    também bloqueiam raspado, mas saem do ar quando acabam."""
    conn = _db()
    sr.ensure_schema(conn)
    house = ("casa-null", "casa-seed", "casa-painel")
    for rid, src in (("casa-null", None), ("casa-seed", "seed"),
                     ("casa-painel", "painel"), ("terceiro-admin", "admin"),
                     ("indicacao", "comunidade"), ("ext-velho", "devpost")):
        conn.execute(
            "INSERT INTO hackathons (id, name, organizer, startsAt, endsAt,"
            " format, registrationUrl, active, source) VALUES"
            " (?, ?, 'Casa', '2020-01-01T09:00:00-03:00',"
            " '2020-01-02T18:00:00-03:00', 'presencial', 'https://x.dev', 1, ?)",
            (rid, f"Hack {rid}", src))
    assert sr.sweep_expired(conn) == 3
    for rid in house:
        assert conn.execute(
            f"SELECT active FROM hackathons WHERE id='{rid}'").fetchone()[0] == 1
    for rid in ("terceiro-admin", "indicacao", "ext-velho"):
        assert conn.execute(
            f"SELECT active FROM hackathons WHERE id='{rid}'").fetchone()[0] == 0

    for rid in (*house, "terceiro-admin", "indicacao"):
        scraped = _row(id=f"mlh-{rid}", name=f"HACK  {rid}",
                       startsAt="2020-01-01T12:00:00Z", source="mlh")
        kept, skipped = sr.filter_vs_existing(conn, [scraped])
        assert kept == [] and len(skipped) == 1, rid

    winners, _ = sr.dedupe([_row(id="devpost-77", name="hack casa-painel",
                                 startsAt="2020-01-01T12:00:00Z")])
    assert sr.deactivate_stale_dupes(conn, winners) == 0
    assert sr.exclude_rejected(
        conn, [({"id": rid}, "nao-hackathon") for rid in house]) == 0
    sr.reclassify_existing(conn)
    for rid in house:
        assert conn.execute(
            f"SELECT active, region FROM hackathons WHERE id='{rid}'"
        ).fetchone() == (1, None)
def test_devpost_tags_pt_sem_premio_nem_token_solto():
    # auditoria 041: "low", "open", "machine" e "premio-$1,000" viravam filtro
    tags = sr.devpost_tags([
        "Machine Learning/AI", "Low/No Code", "Open Ended",
        "Beginner Friendly", "Health",
    ])
    assert tags == ["ia", "iniciante", "saúde"]
    assert sr.devpost_tags(["Enterprise", None, ""]) == []
    assert sr.devpost_tags(["Blockchain", "blockchain"]) == ["web3"]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    try:
        for fn in fns:
            fn()
            print(f"[pass] {fn.__name__}")
    finally:
        _drop_schemas()
    print(f"\n{len(fns)} testes OK")


# ---------- radar global (fixtures reais, 15/10/2026) ----------

def _fix(name):
    return (FIX / name).read_text()


def test_devpost_api_fixture():
    d = sr.json.loads(_fix("devpost_api.json"))
    out = {r["id"]: r for r in sr.parse_devpost_api(d)}
    amz = out["devpost-30992"]
    assert amz["format"] == "online" and amz["location"] is None
    assert amz["prize"] == "$138,000"
    assert amz["startsAt"].startswith("2026-08-31")
    assert amz["endsAt"].startswith("2026-10-23")
    assert amz["eligibilityUrl"] == "https://amazonappdev2026.devpost.com/rules"
    # "Oct 05 - 25, 2026": o mês do início vale pro fim
    assert out["devpost-29114"]["endsAt"].startswith("2026-10-25")
    # presencial guarda o local; prêmio zerado vira None
    loo = out["devpost-31744"]
    assert loo["format"] == "presencial" and loo["location"].startswith("Spur")
    assert loo["prize"] is None


def test_elegibilidade_devpost_exclui_brasil():
    """Caso real: Amazon (US$ 138 mil) — "standard exceptions" inclui o Brasil."""
    el = sr.devpost_eligibility(_fix("devpost_page_30992.html"))
    assert el["brazilOk"] == "nao"
    assert "Brazil" in el["eligibilityNote"]
    assert el["scope"] == "global"
    assert el["submissionDeadline"].startswith("2026-10-23")
    # lista no modal da página, não no tooltip
    el = sr.devpost_eligibility(_fix("devpost_page_31503.html"))
    assert el["brazilOk"] == "nao" and "China" in el["eligibilityNote"]


def test_elegibilidade_devpost_aberto_a_todos():
    """Caso real: IEEE ClimateChain — só exclui a Coreia do Norte."""
    el = sr.devpost_eligibility(_fix("devpost_page_29114.html"))
    assert el["brazilOk"] == "sim"
    assert "Korea" in el["eligibilityNote"] and "Brazil" not in el["eligibilityNote"]
    assert el["scope"] == "global"


def test_elegibilidade_devpost_so_um_pais():
    el = sr.devpost_eligibility(_fix("devpost_page_31113.html"))
    assert el["brazilOk"] == "nao"
    assert el["scope"] == "pais" and el["country"] == "Vietnã"
    el = sr.devpost_eligibility(_fix("devpost_page_31617.html"))
    assert el["brazilOk"] == "nao"
    assert el["scope"] == "pais" and el["country"] == "EUA"
    assert el["eligibilityNote"] == "US only"


def test_elegibilidade_sem_info():
    """Página sem o bloco (ou texto sem regra): não informado, nunca 'sim'."""
    el = sr.devpost_eligibility("<html><body><h1>Hackathon</h1></body></html>")
    assert el["brazilOk"] is None and el["eligibilityNote"] is None
    # descrições reais do lablab não falam de país
    for e in sr.flight_array(sr.next_flight(_fix("lablab_hackathons.html")),
                             "sortedEvents"):
        assert sr.text_eligibility(e.get("description"))["brazilOk"] is None
    # evento online de fora sem regra: fica sem resposta
    r = sr.fill_reach(_row(name="Global AI Jam", source="lablab"))
    assert r["brazilOk"] is None and r["scope"] == "global"


def test_elegibilidade_texto_livre():
    t = sr.text_eligibility
    assert t("The hackathon is open to participants worldwide, 18+.")["brazilOk"] == "sim"
    assert t("Open only to legal residents of the United States.")["brazilOk"] == "nao"
    assert t("Open to all countries except Brazil, Cuba and Iran.")["brazilOk"] == "nao"
    assert t("A global hackathon for builders.")["brazilOk"] is None


def test_devpost_enrich_usa_cache_e_tem_teto():
    rows = sr.parse_devpost_api(sr.json.loads(_fix("devpost_api.json")))
    pages = {"https://amazonappdev2026.devpost.com/": _fix("devpost_page_30992.html")}

    class R:
        def __init__(self, t):
            self.ok, self.text = True, t
    calls = []

    def fetch(url):
        calls.append(url)
        return R(pages.get(url, "<html></html>"))
    sr.ELIG_CACHE.clear()
    sr.ELIG_CACHE["devpost-29114"] = {"brazilOk": "sim", "eligibilityNote": "x"}
    old = sr.DEVPOST_ELIG_SLEEP
    sr.DEVPOST_ELIG_SLEEP = 0
    try:
        n = sr.devpost_enrich(rows, fetch=fetch, max_fetch=2)
    finally:
        sr.DEVPOST_ELIG_SLEEP = old
        sr.ELIG_CACHE.clear()
    assert n == 2 and len(calls) == 2
    # maior prêmio primeiro: Amazon foi lida
    assert calls[0] == "https://amazonappdev2026.devpost.com/"
    by = {r["id"]: r for r in rows}
    assert by["devpost-30992"]["brazilOk"] == "nao"
    # inscrição vai até o prazo de entrega da página, com hora e fuso
    assert by["devpost-30992"]["registrationDeadline"] == "2026-10-23T15:00:00-04:00"
    assert by["devpost-29114"]["brazilOk"] == "sim"  # veio do cache


def test_luma_fixture():
    sp = sr.parse_luma_entries(sr.json.loads(_fix("luma_discover_sp.json"))["entries"])
    by = {r["name"]: r for r in sp}
    shiva = by["Shiva Hack #8 – Stripe + Dalea AI"]
    assert shiva["organizer"] == "Shiva Hacks"
    assert shiva["location"] == "São Paulo, SP"
    assert shiva["registrationUrl"] == "https://luma.com/4iunw1xl"
    r = sr.fill_reach(dict(shiva))
    assert r["region"] == "br" and r["brazilOk"] == "sim" and r["scope"] == "cidade"
    # Luma exige termo de hackathon no nome
    assert sr.classify(by["Lovable Day São Paulo"]) == "nao-hackathon"
    assert sr.classify(shiva) is None
    assert sr.classify(by["DevDay Exchange Community Hackathon: São Paulo"]) is None
    gl = sr.parse_luma_entries(sr.json.loads(_fix("luma_discover_global.json"))["entries"])
    mtc = next(r for r in gl if r["name"] == "MTCHacks")
    r = sr.fill_reach(dict(mtc))
    assert r["region"] == "exterior" and r["country"] == "EUA"
    assert r["brazilOk"] is None


def test_mlh_fixture():
    out = sr.parse_mlh(_fix("mlh_season.html"))
    assert len(out) >= 4
    sw = next(r for r in out if r["name"] == "SwampHacks XII")
    assert sw["location"] == "Gainesville, Florida, EUA"
    assert sw["registrationUrl"] == "https://swamphacks.com/"
    assert sw["startsAt"].startswith("2026-10-16")
    assert any(r["format"] == "hibrido" for r in out)


def test_devfolio_fixture():
    out = {r["id"]: r for r in sr.parse_devfolio(sr.json.loads(_fix("devfolio_open.json")))}
    h = out["devfolio-hackonhills8"]
    assert h["location"] == "Hamirpur, Índia" and h["format"] == "presencial"
    assert h["registrationDeadline"].startswith("2026-10-15")
    assert out["devfolio-arkiv"]["format"] == "online"


def test_lablab_fixture():
    out = sr.parse_lablab(_fix("lablab_hackathons.html"), now=NOW_FIX)
    names = {r["name"] for r in out}
    assert "Vultr: Agent Rush Hackathon" in names
    v = next(r for r in out if r["name"] == "Vultr: Agent Rush Hackathon")
    assert v["format"] == "hibrido"
    # híbrido sem cidade conta como online
    assert sr.fill_reach(dict(v))["region"] == "online-mundo"


def test_hackclub_fixture():
    out = sr.parse_hackclub(sr.json.loads(_fix("hackclub_upcoming.json")))
    peel = next(r for r in out if r["name"] == "Hack Peel")
    assert peel["location"] == "Mississauga, Ontario, Canadá"
    pix = next(r for r in out if r["name"] == "Pixel Forge Mega Jam")
    assert pix["format"] == "online" and pix["location"] is None


def test_taikai_datas_pelas_etapas():
    d = {"data": {"challenges": [
        {"name": "CASSINI Hackathons", "slug": "cassini", "isClosed": False,
         "prize": 30000, "prizeCurrency": {"name": "EUR"},
         "organization": {"name": "EU", "slug": "eu"},
         "steps": [{"name": " Registration Deadline", "startDate": "2026-11-20T10:00:00Z"},
                   {"name": "Registrations open", "startDate": "2026-09-28T10:00:00Z"},
                   {"name": "Submission Deadline", "startDate": "2026-11-29T10:00:00Z"},
                   {"name": "Demo Day and Awards", "startDate": "2026-12-02T10:00:00Z"}]},
        {"name": "Velho", "slug": "velho", "isClosed": True, "steps": [
            {"name": "x", "startDate": "2026-01-01"}]},
    ]}}
    out = sr.parse_taikai(d)
    assert len(out) == 1
    c = out[0]
    assert c["startsAt"].startswith("2026-09-28") and c["endsAt"].startswith("2026-12-02")
    assert c["registrationDeadline"].startswith("2026-11-20")
    assert c["submissionDeadline"].startswith("2026-11-29")
    assert c["prize"] == "€30,000"


def test_marca_e_premio_em_dolar():
    r = sr.fill_reach(_row(name="Nebius x NVIDIA Global AI Hackathon",
                           organizer="Nebius", prize="$50,000"))
    assert r["brand"] == "NVIDIA" and r["prizeUsd"] == 50000
    assert sr.brand_of({"name": "NASA Space Apps Challenge", "organizer": "NASA"}) == "NASA"
    assert sr.brand_of({"name": "Meta Llama Hackathon", "organizer": "x"}) == "Meta"
    assert sr.brand_of({"name": "Hackathon do TJPA", "organizer": "TJPA"}) is None


def test_upsert_grava_elegibilidade_e_cache():
    conn = _db()
    row = _row(id="devpost-1", name="Amazon Hackathon", prize="$138,000",
               brazilOk="nao", eligibilityNote="All countries/territories, excluding: Brazil",
               eligibilityUrl="https://a.devpost.com/rules", scope="global",
               eligibilityCheckedAt=sr.NOW.isoformat(),
               submissionDeadline="2999-01-02T18:00:00-03:00")
    sr.upsert(conn, [row])
    got = conn.execute(
        "SELECT brazilOk, scope, prizeUsd, eligibilityUrl, submissionDeadline"
        " FROM hackathons WHERE id='devpost-1'").fetchone()
    assert got == ("nao", "global", 138000, "https://a.devpost.com/rules",
                   "2999-01-02T18:00:00-03:00")
    # rodada seguinte sem ler a página (cache) não apaga a regra
    sr.upsert(conn, [_row(id="devpost-1", name="Amazon Hackathon", prize="$138,000")])
    assert conn.execute("SELECT brazilOk FROM hackathons WHERE id='devpost-1'"
                        ).fetchone()[0] == "nao"
    cache = sr.load_elig_cache(conn)
    assert cache["devpost-1"]["brazilOk"] == "nao"


def test_lablab_pagina_do_evento_traz_premio():
    d = sr.lablab_page_details(_fix("lablab_evento_vultr.html"))
    assert d["prize"] == "$9,000"
    assert "brazilOk" not in d  # a página não fala de país


def test_pais_explicito_nao_vira_uf():
    """"Cluj-Napoca, RO" é Romênia, não Rondônia."""
    r = sr.fill_reach(_row(name="Arcade Game Jam", source="luma",
                           format="presencial", location="Cluj-Napoca, Romania",
                           country="RO"))
    assert r["region"] == "exterior"
    assert sr.region_of(_row(source="mlh", format="presencial",
                             location="Timișoara, Timiș, RO", country="RO")) == "exterior"
    # jam de improviso não é hackathon
    assert sr.classify(_row(name="BIPOC Improv Jam", source="luma")) == "nao-hackathon"
    assert sr.classify(_row(name="Women Game Jam Brazil", source="luma")) is None


def test_pagina_oficial_meta():
    """Meta Global AI Developer Hackathon: US$ 1 mi, virtual, aberto ao mundo
    menos países sob sanção — o Brasil não está na lista."""
    r = sr.parse_brand_page(_fix("meta_global_hackathon.html"),
                            "meta-global-ai-hackathon",
                            "https://dev.meta.ai/events/global-hackathon", "Meta")
    assert r["name"] == "Meta Global AI Developer Hackathon"
    assert r["prize"] == "$1,000,000"
    assert r["format"] == "online"
    # hora e fuso da página: "Oct 25, 11:59 PM ET"
    assert r["registrationDeadline"] == "2026-10-25T23:59:00-04:00"
    assert r["startsAt"].startswith("2026-10-26")
    assert r["submissionDeadline"] == "2026-11-04T21:00:00-05:00"  # 9 PM ET, já sem horário de verão
    assert r["endsAt"].startswith("2026-11-09")
    assert r["brazilOk"] == "sim"
    assert r["eligibilityNote"].lower().startswith("open worldwide")
    f = sr.fill_reach(dict(r))
    assert f["scope"] == "global" and f["brand"] == "Meta" and f["prizeUsd"] == 1_000_000


def test_import_wohackers_dry_run(tmp_path):
    """Importador da planilha WoHackers (só roda com OK do dono): lê o
    formato do CSV, dá crédito e pula o que já passou."""
    import import_wohackers as iw
    csv = tmp_path / "w.csv"
    csv.write_text(
        "MÊS,DIA DA SEMANA,,,,,,,,EVENTO,COMUNIDADE e Parcerias,Inscrição,"
        "INSCRIÇÃO / Link sobre,LOCAL,CIDADE,UF\n"
        "NOV,,,,,,15,,,Hack Teste,Org X,09/11/2026,https://x.dev/h,"
        "Impact Hub,Florianópolis,SC\n"
        "MAR,,,,,,7,,,Hack Velho,Org Y,01/03/2026,https://x.dev/v,On-line,,\n"
        "NOV,,,,,,,,,Sem link,Org Z,,,,,\n", encoding="utf-8")
    rows = iw.parse_rows(str(csv), now=NOW_FIX)
    assert [r["name"] for r in rows] == ["Hack Teste"]
    r = rows[0]
    assert r["organizer"] == "Org X · via calendário WoHackers"
    assert r["registrationUrl"] == "https://x.dev/h"
    assert r["location"] == "Florianópolis, SC" and r["source"] == "curadoria"
    assert r["registrationDeadline"].startswith("2026-11-09")


def test_upsert_recalcula_sim_derivado():
    """'sim' que veio de heurística (e não de regra lida) é recalculado: o
    evento que deixou de ser do Brasil perde o 'sim'."""
    conn = _db()
    sr.upsert(conn, [_row(id="luma-x", name="Arcade Game Jam", source="luma",
                          format="presencial", location="Cluj-Napoca, RO")])
    conn.execute("UPDATE hackathons SET brazilOk='sim' WHERE id='luma-x'")
    sr.upsert(conn, [_row(id="luma-x", name="Arcade Game Jam", source="luma",
                          format="presencial", location="Cluj-Napoca, Romania",
                          country="RO")])
    assert conn.execute("SELECT brazilOk, region FROM hackathons WHERE id='luma-x'"
                        ).fetchone() == (None, "exterior")


def test_portugues_sozinho_nao_prova_brasileiro():
    r = sr.fill_reach(_row(name="Hack4Guimarães 2035 — inovação", source="taikai"))
    assert r["region"] == "online-br" and r["brazilOk"] is None
    r = sr.fill_reach(_row(name="Hackathon Online", source="sympla"))
    assert r["brazilOk"] == "sim"
