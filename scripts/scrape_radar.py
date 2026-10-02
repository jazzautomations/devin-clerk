"""Radar scraper — puxa hackathons reais de verdade pro HackaHub.

Fontes:
  - Devpost     API pública /api/hackathons
  - TAIKAI      GraphQL api.taikai.network
  - ETHGlobal   HTML via Scrapling
  - MLH         HTML via Scrapling (seasons 2026/2027)
  - Meetup      Jina Reader (JS-rendered)
  - Luma        Jina Reader (JS-rendered)
  - Curadoria   BR verificado manualmente (STS, HackaSanta, TJPA, HCFMUSP)

Uso:
  uv run --python .venv-scraper/bin/python scripts/scrape_radar.py

Upsert por id estável: registrations nunca são apagadas. Eventos da
comunidade (sem `source`) nunca são desativados aqui.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dateutil import parser as dateparser

DB = Path(__file__).resolve().parent.parent / "data" / "hackahub.db"
NOW = datetime.now(timezone.utc)

def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60]


def iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def parse_date(s: str):
    try:
        return dateparser.parse(s, fuzzy=True)
    except Exception:
        return None


def upsert(conn, rows: list[dict]) -> int:
    sql = """INSERT INTO hackathons
      (id, name, organizer, startsAt, endsAt, format, location,
       registrationUrl, registrationDeadline, tags, active, source)
    VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location,
       @registrationUrl, @registrationDeadline, @tags, 1, @source)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, organizer=excluded.organizer,
      startsAt=excluded.startsAt, endsAt=excluded.endsAt,
      format=excluded.format, location=excluded.location,
      registrationUrl=excluded.registrationUrl,
      registrationDeadline=excluded.registrationDeadline,
      tags=excluded.tags, active=1, source=excluded.source"""
    n = 0
    for r in rows:
        if not r.get("startsAt"):
            continue
        r["tags"] = json.dumps(r.get("tags") or [])
        conn.execute(sql, r)
        n += 1
    return n


# ---------- fontes ----------

def src_devpost() -> list[dict]:
    out = []
    for page in (1, 2):
        d = requests.get(
            "https://devpost.com/api/hackathons",
            params={"status": "open", "page": page},
            headers={"Accept": "application/json"},
            timeout=20,
        ).json()
        for h in d.get("hackathons", []):
            if h.get("open_state") != "open" or h.get("invite_only"):
                continue
            m = re.match(
                r"(.+?)\s*-\s*(.+),\s*(\d{4})",
                h.get("submission_period_dates") or "",
            )
            start = end = None
            if m:
                start = parse_date(f"{m.group(1)}, {m.group(3)}")
                end = parse_date(f"{m.group(2)}, {m.group(3)}")
            loc = (h.get("displayed_location") or {}).get("location") or "Online"
            fmt = "online" if loc == "Online" else "presencial"
            prize = re.sub(r"<[^>]+>", "", h.get("prize_amount") or "")
            tags = [t["name"].lower().split("/")[0].split(" ")[0]
                    for t in h.get("themes", [])][:3]
            if prize:
                tags.append(f"premio-{prize}")
            out.append({
                "id": f"devpost-{h['id']}",
                "name": h["title"],
                "organizer": h.get("organization_name") or "Devpost",
                "startsAt": iso(start),
                "endsAt": iso(end),
                "format": fmt,
                "location": None if loc == "Online" else loc,
                "registrationUrl": h["url"],
                "registrationDeadline": iso(end),
                "tags": tags,
                "source": "devpost",
            })
        if not d.get("meta", {}).get("has_next"):
            break
    return out


def src_taikai() -> list[dict]:
    q = """query { challenges(where: { publishInfo: { state: { equals: ACTIVE } } },
      perPage: 30) { name slug prize organization { name slug }
      participantsCount currentStep { name startDate } } }"""
    d = requests.post(
        "https://api.taikai.network/api/graphql",
        json={"query": q}, timeout=20,
    ).json()
    out = []
    for c in d["data"]["challenges"]:
        step = c.get("currentStep") or {}
        org = c.get("organization") or {}
        prize = c.get("prize") or 0
        tags = []
        if prize:
            tags.append(f"premio-{int(prize)}")
        out.append({
            "id": f"taikai-{c['slug']}",
            "name": c["name"],
            "organizer": org.get("name") or "TAIKAI",
            "startsAt": step.get("startDate") or iso(NOW),
            "endsAt": None,
            "format": "online",
            "location": None,
            "registrationUrl": f"https://taikai.network/{org.get('slug','')}/hackathons/{c['slug']}",
            "registrationDeadline": None,
            "tags": tags,
            "source": "taikai",
        })
    return out


def src_ethglobal() -> list[dict]:
    # página é client-rendered — Jina entrega o texto resolvido
    md = jina("https://ethglobal.com/events")
    out = []
    seen = set()
    # card: "### ETHGlobal Tokyo 2026 Sep 25th– Sep 27th, 2026 ... Hackathon](url)"
    pat = re.compile(
        r"###\s*(.+?)\s+([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th)"
        r"(?:–\s*(?:[A-Z][a-z]{2}\s*)?(\d{1,2})(?:st|nd|rd|th)?)?,\s*(\d{4})"
        r"[^\]]*?Hackathon[^\]]*?\]\((https?://[^)\s]+)\)",
    )
    for m in pat.finditer(md):
        name, mon, d1, d2, year, url = m.groups()
        start = parse_date(f"{mon} {d1} {year}")
        end = parse_date(f"{mon} {d2} {year}") if d2 else start
        if not start or (end and end < NOW.replace(tzinfo=None)):
            continue  # passado não entra no radar
        slug = slugify(re.sub(r"(?i)\bETHGlobal\b|\d{4}", "", name).strip() or name)
        if slug in seen:
            continue
        seen.add(slug)
        out.append({
            "id": f"ethglobal-{slug}",
            "name": name.strip(),
            "organizer": "ETHGlobal",
            "startsAt": iso(start),
            "endsAt": iso(end),
            "format": "online" if "online" in name.lower() else "presencial",
            "location": None,
            "registrationUrl": url,
            "registrationDeadline": None,
            "tags": ["web3", "ethereum"],
            "source": "ethglobal",
        })
    return out


def src_mlh() -> list[dict]:
    from scrapling.fetchers import Fetcher

    out = []
    for season in ("2027", "2026"):
        try:
            page = Fetcher.get(
                f"https://mlh.io/seasons/{season}/events",
                impersonate="chrome", timeout=30,
            )
        except Exception:
            continue
        html = page.body.decode("utf-8", "replace")
        up = html.split("Upcoming Events", 1)
        if len(up) < 2:
            continue
        section = up[1].split("Past Events", 1)[0]
        for m in re.finditer(
            r'<a href="(https://events\.mlh\.io/events/(\d+)-[a-z0-9-]+)[^"]*"'
            r'[^>]*itemType="https://schema\.org/Event">(.*?)</a>',
            section, re.S,
        ):
            url, eid, block = m.groups()

            def prop(name):
                mm = re.search(rf'itemProp="{name}"[^>]*content="([^"]*)"',
                               block)
                return mm.group(1) if mm else ""

            tm = re.search(r"<h4[^>]*>([^<]+)</h4>", block)
            title = tm.group(1).strip() if tm else ""
            if not title:
                continue
            start = prop("startDate")
            end = prop("endDate")
            parts = [
                prop("addressLocality"),
                prop("addressRegion"),
                prop("addressCountry"),
            ]
            loc = ", ".join(p for p in parts if p)
            online = "Online" in prop("eventAttendanceMode")
            out.append({
                "id": f"mlh-{eid}",
                "name": title,
                "organizer": "MLH",
                "startsAt": start or iso(NOW),
                "endsAt": end or None,
                "format": "online" if online else "presencial",
                "location": None if online else loc,
                "registrationUrl": url,
                "registrationDeadline": None,
                "tags": ["mlh", "estudante"],
                "source": "mlh",
            })
    return out


def jina(url: str) -> str:
    r = requests.get(f"https://r.jina.ai/{url}", timeout=40)
    return r.text if r.ok else ""


def src_meetup() -> list[dict]:
    out = []
    seen = set()
    cidades = {
        "br--sao-paulo": "São Paulo",
        "br--rio-de-janeiro": "Rio de Janeiro",
        "br--belo-horizonte": "Belo Horizonte",
    }
    for loc, cidade in cidades.items():
        md = jina(
            f"https://www.meetup.com/find/?keywords=hackathon&location={loc}"
        )
        # cada card é um parágrafo próprio separado por linha em branco
        for para in md.split("\n\n"):
            lm = re.search(
                r"meetup\.com/([a-z0-9-]+)/events/(\d+)", para,
            )
            if not lm:
                continue
            group, eid = lm.groups()
            if eid in seen:
                continue
            seen.add(eid)
            tm = re.search(r"###\s+(.+?)\s+\w{3},", para)
            if not tm:
                continue
            title = tm.group(1).strip()
            if not re.search(r"(?i)hack|maratona|datathon|buildathon", title):
                continue
            dm = re.search(
                r"(\w{3}), (\w{3}) (\d{1,2}) · ([\d: ]+(?:AM|PM)) (\w+)",
                para,
            )
            chunk = para
            start = (
                parse_date(f"{dm.group(2)} {dm.group(3)} {dm.group(4)} 2026")
                if dm
                else NOW
            )
            online = " · Online" in chunk
            org = re.search(r"\bby ([^*\[]+?)\s*\d", chunk)
            out.append({
                "id": f"meetup-{eid}",
                "name": title,
                "organizer": org.group(1).strip() if org else group.replace("-", " ").title(),
                "startsAt": iso(start),
                "endsAt": None,
                "format": "online" if online else "presencial",
                "location": None if online else cidade,
                "registrationUrl": f"https://www.meetup.com/{group}/events/{eid}",
                "registrationDeadline": None,
                "tags": ["meetup"],
                "source": "meetup",
            })
        time.sleep(2)
    return out


def src_luma() -> list[dict]:
    out = []
    seen = set()
    for path in ("hackathon", "tech"):
        md = jina(f"https://lu.ma/{path}")
        for m in re.finditer(
            r"\[([^\]]{6,140})\]\(https://lu\.ma/([a-zA-Z0-9_-]{6,})\)", md,
        ):
            title, slug = m.groups()
            if slug in seen or slug in ("tech", "hackathon", "discover"):
                continue
            if not re.search(r"(?i)hack|sprint|buildathon", title):
                continue
            seen.add(slug)
            out.append({
                "id": f"luma-{slug.lower()}",
                "name": title.strip(),
                "organizer": "Luma",
                "startsAt": iso(NOW),
                "endsAt": None,
                "format": "online",
                "location": None,
                "registrationUrl": f"https://lu.ma/{slug}",
                "registrationDeadline": None,
                "tags": ["luma"],
                "source": "luma",
            })
        time.sleep(2)
    return out


def src_curated() -> list[dict]:
    """BR verificado à mão nas fontes oficiais — curadoria editorial."""
    return [
        {
            "id": "hackathon-sts-2026",
            "name": "Hackathon STS 2026",
            "organizer": "Siará Tech Summit × Sebrae",
            "startsAt": "2026-10-07T09:00:00-03:00",
            "endsAt": "2026-10-09T18:00:00-03:00",
            "format": "presencial",
            "location": "Centro de Eventos do Ceará, Fortaleza",
            "registrationUrl": "https://stssebrae.com.br/hackathon/",
            "registrationDeadline": "2026-10-04T23:59:00-03:00",
            "tags": ["ia", "inovacao"],
            "source": "curadoria",
        },
        {
            "id": "hackasanta-2026",
            "name": "HackaSanta — Saúde",
            "organizer": "FCM Santa Casa SP",
            "startsAt": "2026-10-17T08:00:00-03:00",
            "endsAt": "2026-10-18T18:00:00-03:00",
            "format": "presencial",
            "location": "Santa Casa, São Paulo",
            "registrationUrl": "https://hackasanta.com.br",
            "registrationDeadline": None,
            "tags": ["saude", "ia"],
            "source": "curadoria",
        },
        {
            "id": "hackathon-tjpa-2026",
            "name": "1° Hackathon do TJPA",
            "organizer": "TJ Pará × Açaí Valley",
            "startsAt": "2026-10-21T08:00:00-03:00",
            "endsAt": "2026-11-06T18:00:00-03:00",
            "format": "hibrido",
            "location": "Belém, PA",
            "registrationUrl": "https://comunidade.devsnorte.com/eventos/1-hackathon-do-tjpa-466",
            "registrationDeadline": None,
            "tags": ["gov", "premio-r15k"],
            "source": "curadoria",
        },
        {
            "id": "hackathon-hcfmusp-2026",
            "name": "II Hackathon Saúde HCFMUSP",
            "organizer": "Hospital das Clínicas FMUSP",
            "startsAt": "2026-11-06T09:00:00-03:00",
            "endsAt": "2026-11-07T18:00:00-03:00",
            "format": "presencial",
            "location": "Hospital das Clínicas, São Paulo",
            "registrationUrl": "https://www.hackathon-saude.com",
            "registrationDeadline": None,
            "tags": ["saude", "ia"],
            "source": "curadoria",
        },
        {
            "id": "ethglobal-mumbai-2026",
            "name": "ETHGlobal Mumbai",
            "organizer": "ETHGlobal",
            "startsAt": "2026-11-05T09:00:00+05:30",
            "endsAt": "2026-11-07T18:00:00+05:30",
            "format": "presencial",
            "location": "Mumbai, Índia",
            "registrationUrl": "https://ethglobal.com/events/mumbai",
            "registrationDeadline": None,
            "tags": ["web3", "ethereum"],
            "source": "curadoria",
        },
        {
            "id": "nasa-space-apps-2026",
            "name": "NASA Space Apps Challenge",
            "organizer": "NASA",
            "startsAt": "2026-10-03T00:00:00-03:00",
            "endsAt": "2026-10-04T23:59:00-03:00",
            "format": "hibrido",
            "location": "Várias cidades, BR + mundo",
            "registrationUrl": "https://www.spaceappschallenge.org",
            "registrationDeadline": None,
            "tags": ["espaco", "dados"],
            "source": "curadoria",
        },
    ]


SOURCES = [
    ("devpost", src_devpost),
    ("taikai", src_taikai),
    ("ethglobal", src_ethglobal),
    ("mlh", src_mlh),
    ("meetup", src_meetup),
    ("luma", src_luma),
    ("curadoria", src_curated),
]


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(hackathons)")}
    if "source" not in cols:
        conn.execute("ALTER TABLE hackathons ADD COLUMN source TEXT")

    total = 0
    for name, fn in SOURCES:
        try:
            rows = fn()
            n = upsert(conn, rows)
            total += n
            print(f"[ok] {name:10s} {n:3d} eventos")
        except Exception as e:  # fonte quebrada não derruba o resto
            print(f"[fail] {name:8s} {e}", file=sys.stderr)
    conn.commit()
    print(f"\nTotal upsert: {total}")
    print("Radar externo no banco:",
          conn.execute(
              "SELECT COUNT(*) FROM hackathons WHERE source IS NOT NULL AND active=1"
          ).fetchone()[0])


if __name__ == "__main__":
    main()
