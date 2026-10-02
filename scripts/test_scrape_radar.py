"""Testes do scraper v2 — asserts puros (a venv não tem pytest).

Uso:
  uv run --python .venv-scraper/bin/python scripts/test_scrape_radar.py
  # ou
  npm run test:scrape
"""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape_radar as sr  # noqa: E402


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
    conn = sqlite3.connect(":memory:")
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
    conn = sqlite3.connect(":memory:")
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
    conn = sqlite3.connect(":memory:")
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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"[pass] {fn.__name__}")
    print(f"\n{len(fns)} testes OK")
