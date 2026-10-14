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


def test_ethglobal_md_parser():
    md = ("[![Image 1: Foo logo](https://cdn/x.png) ### ETHGlobal Lisboa 2026 "
          "Jul 24th– Jul 26th, 2999 Jul 24th– Jul 26th, 2999 Hackathon]"
          "(https://ethglobal.com/events/lisboa2999)"
          "[![Image 2](https://cdn/y.png) ### Pragma Lisboa 2999 Jul 25th, 2999 "
          "Jul 25th, 2999 Conference](https://ethglobal.com/events/pragma)")
    out = sr.parse_ethglobal_md(md)
    assert len(out) == 1, out                      # conference fora
    e = out[0]
    assert e["name"] == "ETHGlobal Lisboa 2026", e
    assert e["startsAt"].startswith("2999-07-24"), e["startsAt"]
    assert e["endsAt"].startswith("2999-07-26"), e["endsAt"]
    assert e["source"] == "ethglobal"
    # card passado não entra
    md_past = ("### ETHGlobal Velho 2020 Jan 10th– Jan 12th, 2020 "
               "Jan 10th– Jan 12th, 2020 Hackathon](https://ethglobal.com/e/v)")
    assert sr.parse_ethglobal_md(md_past) == []


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
    assert sr.classify(_row(name="2026-2027 Fall ESE Senior Design",
                            organizer="university of pennsylvania", **ok)
                       ) == "disciplina"
    assert sr.classify(_row(name="Pumpkin Playground", organizer="ACM",
                            prize="$30", **ok)) == "premio-irrisorio"
    assert sr.classify(_row(name="Next Byte Hacks V5", organizer="NBH",
                            prize="$100", **ok)) == "premio-irrisorio"
    assert sr.classify(_row(name="InternWell Hack2.0", organizer="SLIET",
                            prize="₹ 1,000", **ok)) == "premio-irrisorio"
    assert sr.classify(_row(name="Code for Humanity", organizer="nill",
                            **ok)) == "organizador-vazio"
    assert sr.classify(_row(name="Ghost Hack", organizer="Org",
                            source="devpost", registrations=3)
                       ) == "sem-inscritos"
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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    try:
        for fn in fns:
            fn()
            print(f"[pass] {fn.__name__}")
    finally:
        _drop_schemas()
    print(f"\n{len(fns)} testes OK")
