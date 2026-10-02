"""Radar scraper v2 — puxa hackathons reais de verdade pro HackaHub.

Fontes:
  - Devpost     API pública /api/hackathons (paginada: page/per_page)
  - TAIKAI      GraphQL api.taikai.network
  - ETHGlobal   Jina markdown, cards tipados (fallback: endpoints JSON)
  - MLH         HTML via Scrapling (seasons 2026/2027)
  - Meetup      Jina Reader (JS-rendered)
  - Luma        Jina Reader (JS-rendered) — geogated, costuma dar 0
  - Curadoria   BR verificado manualmente

Pipeline: coletar → classificar (fontes ruidosas) → deduplicar
(dedupe_key = nome normalizado + data de início) → filtrar vs comunidade
→ upsert (active=0 se expirado, first_seen/last_seen) → reconciliar
dupes antigas → sweep de expirados.

Uso:
  uv run --python .venv-scraper/bin/python scripts/scrape_radar.py
  npm run test:scrape  # testes

Upsert por id estável: registros nunca são apagados. Eventos da
comunidade (sem `source`) nunca são alterados nem desativados aqui.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests
from dateutil import parser as dateparser

DB = Path(__file__).resolve().parent.parent / "data" / "hackahub.db"
NOW = datetime.now(timezone.utc)

DEVPOST_MAX_PAGES = 5
DEVPOST_PER_PAGE = 24
DEVPOST_PAGE_SLEEP = 1.2

# fontes ruidosas passam pelo classificador; devpost/taikai são
# inerentemente hackathons; ethglobal filtra pelo tipo do card
NEEDS_FILTER = {"mlh", "meetup", "luma", "curadoria"}
ZERO_IS_DEGRADED = {"ethglobal", "luma"}  # 0 aqui = fonte degradada, log claro


# ---------- helpers ----------

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


def _aware(dt):
    """datetime naive → UTC (strings ISO sem offset são tratadas como UTC)."""
    if dt and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def norm_name(s: str) -> str:
    """Lowercase sem acento e sem não-alfanumérico: 'Hacka Santa!' == 'hackasanta'."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def dedupe_key(row: dict) -> str:
    """Identidade de negócio: mesmo nome normalizado + mesmo dia de início."""
    return f"{norm_name(row.get('name'))}|{(row.get('startsAt') or '')[:10]}"


def prize_display(raw: str | None) -> str | None:
    """'$<span data-currency-value>138,000</span>' → '$138,000'.

    Devpost manda o valor com HTML embutido na listagem (`prizes` separado
    vem sempre null). String vazia ou montante todo zerado ('$0') vira
    None — premiação zero não é argumento de venda.
    """
    s = " ".join(re.sub(r"<[^>]+>", "", raw or "").split())
    if not s:
        return None
    digits = re.sub(r"\D", "", s)
    if digits and int(digits) == 0:
        return None
    return s


TAIKAI_CURRENCY = {"EUR": "€", "USD": "$", "GBP": "£", "BRL": "R$"}


def taikai_prize(amount, currency_name: str | None) -> str | None:
    """prize int + código de moeda → '€20,000' / '$3,500'.

    Símbolo só pros códigos mapeados; moeda desconhecida cai pro código
    ('XYZ 1,000') — nunca inventa cifrão.
    """
    if not amount:
        return None
    n = f"{int(amount):,}"
    sym = TAIKAI_CURRENCY.get((currency_name or "").upper())
    if sym:
        return f"{sym}{n}"
    return f"{currency_name} {n}" if currency_name else n


def metadata_score(row: dict) -> float:
    s = sum(
        1
        for f in (
            "organizer", "endsAt", "format", "location",
            "registrationUrl", "registrationDeadline", "prize",
        )
        if row.get(f)
    )
    s += len(row.get("tags") or [])
    if row.get("source") == "curadoria":
        s += 0.5  # curadoria é verificada à mão — desempata
    return float(s)


def merge_rows(group: list[dict]) -> dict:
    """Vencedor = mais metadados; perdedores preenchem vazios e unem tags."""
    win = max(group, key=metadata_score)
    merged = dict(win)
    for r in group:
        if r is win:
            continue
        for f in (
            "organizer", "endsAt", "format", "location",
            "registrationUrl", "registrationDeadline", "prize",
        ):
            if not merged.get(f) and r.get(f):
                merged[f] = r[f]
    tags: list[str] = []
    for r in group:
        for t in r.get("tags") or []:
            if t not in tags:
                tags.append(t)
    merged["tags"] = tags[:6]
    merged["source"] = "+".join(sorted({r.get("source") or "?" for r in group}))
    return merged


def dedupe(rows: list[dict]) -> tuple[list[dict], int]:
    """Agrupa por dedupe_key; retorna (vencedores, nº de linhas absorvidas)."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(dedupe_key(r), []).append(r)
    winners, merges = [], 0
    for g in groups.values():
        merges += len(g) - 1
        winners.append(merge_rows(g))
    return winners, merges


HACK_RE = re.compile(
    r"(?i)hack|datathon|buildathon|ideathon|makeathon|game\s?jam|codefest"
)
DENY_RE = re.compile(
    r"(?i)\b(conference|summit|congresso|congress|meetup|meet-?up|talk|"
    r"workshop|feira|webinar|co-?working|seminar|semin[aá]rio|encontro|"
    r"pizza party|happy hour)\b"
)


def is_hackathon(name: str, tags=None, description: str | None = None) -> bool:
    """Só hackathon de verdade entra no radar.

    Termo de hack no nome/tags/descrição → aceita sempre (vence a denylist).
    Palavra da denylist no nome/descrição sem termo de hack → rejeita.
    Neutro (sem deny, sem hack) → aceita: as fontes já buscam por "hackathon"
    e nomes legítimos tipo "NASA Space Apps Challenge" não levam "hack".
    Denylist não olha `tags`: a tag 'meetup' é rótulo nosso, não do evento.
    """
    hay = " ".join([name or "", " ".join(tags or []), description or ""])
    if HACK_RE.search(hay):
        return True
    if DENY_RE.search(" ".join([name or "", description or ""])):
        return False
    return True


def is_expired(row: dict, now: datetime | None = None) -> bool:
    dt = parse_date(row.get("endsAt") or row.get("startsAt") or "")
    return bool(dt) and _aware(dt) < (now or NOW)


# ---------- schema / persistência ----------

def ensure_schema(conn) -> None:
    """Cria a tabela se faltar e faz ALTERs idempotentes (pattern de lib/db.ts)."""
    conn.execute(
        """CREATE TABLE IF NOT EXISTS hackathons (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          organizer TEXT NOT NULL,
          startsAt TEXT NOT NULL,
          endsAt TEXT,
          format TEXT NOT NULL CHECK (format IN ('online','presencial','hibrido')),
          location TEXT,
          registrationUrl TEXT NOT NULL,
          registrationDeadline TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1
        )"""
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(hackathons)")}
    for col in ("source", "first_seen", "last_seen", "prize"):
        if col not in cols:
            conn.execute(f"ALTER TABLE hackathons ADD COLUMN {col} TEXT")
    # backfill: linhas antigas ganham timestamps da migração
    conn.execute(
        "UPDATE hackathons SET first_seen = ? WHERE first_seen IS NULL",
        (NOW.isoformat(),),
    )
    conn.execute(
        "UPDATE hackathons SET last_seen = first_seen WHERE last_seen IS NULL"
    )


UPSERT_SQL = """INSERT INTO hackathons
  (id, name, organizer, startsAt, endsAt, format, location,
   registrationUrl, registrationDeadline, tags, active, source, prize,
   first_seen, last_seen)
VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location,
   @registrationUrl, @registrationDeadline, @tags, @active, @source,
   @prize, @now, @now)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, organizer=excluded.organizer,
  startsAt=excluded.startsAt, endsAt=excluded.endsAt,
  format=excluded.format, location=excluded.location,
  registrationUrl=excluded.registrationUrl,
  registrationDeadline=excluded.registrationDeadline,
  tags=excluded.tags, active=excluded.active, source=excluded.source,
  prize=excluded.prize,
  last_seen=excluded.last_seen"""


def upsert(conn, rows: list[dict]) -> int:
    """Insere/atualiza por id estável; active reflete expiração; nunca apaga."""
    n = 0
    for r in rows:
        if not r.get("startsAt"):
            continue
        r = dict(r)
        r["tags"] = json.dumps(r.get("tags") or [])
        r["active"] = 0 if is_expired(r) else 1
        r.setdefault("prize", None)  # fonte sem prêmio grava NULL
        r["now"] = NOW.isoformat()
        conn.execute(UPSERT_SQL, r)
        n += 1
    return n


def filter_vs_existing(conn, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Raspado cuja chave já existe na comunidade (source IS NULL) é skipado
    — o evento da casa é autoridade, e inserir criaria dupe visível no radar."""
    community = {
        dedupe_key({"name": n, "startsAt": s})
        for n, s in conn.execute(
            "SELECT name, startsAt FROM hackathons WHERE source IS NULL"
        )
    }
    kept, skipped = [], []
    for r in rows:
        (skipped if dedupe_key(r) in community else kept).append(r)
    return kept, skipped


def deactivate_stale_dupes(conn, winners: list[dict]) -> int:
    """Linhas externas antigas com mesma chave do vencedor e id diferente
    (ex.: evento mudou de fonte entre rodagens) → active=0, nunca DELETE."""
    win_ids = {dedupe_key(w): w["id"] for w in winners}
    n = 0
    for rid, name, starts in conn.execute(
        "SELECT id, name, startsAt FROM hackathons"
        " WHERE source IS NOT NULL AND active = 1"
    ):
        wid = win_ids.get(dedupe_key({"name": name, "startsAt": starts}))
        if wid and wid != rid:
            conn.execute("UPDATE hackathons SET active=0 WHERE id=?", (rid,))
            n += 1
    return n


def sweep_expired(conn) -> int:
    """Externos cuja data passou → active=0. Comunidade (source NULL) intacta."""
    cur = conn.execute(
        """UPDATE hackathons SET active=0
           WHERE source IS NOT NULL AND active=1
             AND datetime(COALESCE(endsAt, startsAt)) < datetime('now')"""
    )
    return cur.rowcount


# ---------- fontes ----------

def src_devpost() -> list[dict]:
    """API pública paginada — meta.total_count governa (has_next não existe)."""
    out = []
    for page in range(1, DEVPOST_MAX_PAGES + 1):
        d = requests.get(
            "https://devpost.com/api/hackathons",
            params={"status": "open", "page": page,
                    "per_page": DEVPOST_PER_PAGE},
            headers={"Accept": "application/json"},
            timeout=20,
        ).json()
        hs = d.get("hackathons", [])
        if not hs:
            break
        for h in hs:
            if h.get("open_state") != "open" or h.get("invite_only"):
                continue
            m = re.match(
                r"(.+?)\s*-\s*(.+),\s*(\d{4})",
                h.get("submission_period_dates") or "",
            )
            start = end = None
            if m:
                start = parse_date(f"{m.group(1)}, {m.group(3)}")
                d2 = m.group(2).strip()
                if re.fullmatch(r"\d{1,2}", d2):  # "Nov 3 - 5, 2026"
                    mon = re.match(r"[A-Za-z]+", m.group(1))
                    if mon:
                        d2 = f"{mon.group(0)} {d2}"
                end = parse_date(f"{d2}, {m.group(3)}")
            loc = (h.get("displayed_location") or {}).get("location") or "Online"
            fmt = "online" if loc == "Online" else "presencial"
            prize = prize_display(h.get("prize_amount"))
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
                "prize": prize,
                "source": "devpost",
            })
        total = (d.get("meta") or {}).get("total_count") or 0
        if page * DEVPOST_PER_PAGE >= total:
            break
        time.sleep(DEVPOST_PAGE_SLEEP)  # educado com a API
    return out


def src_taikai() -> list[dict]:
    q = """query { challenges(where: { publishInfo: { state: { equals: ACTIVE } } },
      perPage: 30) { name slug prize prizeCurrency { name }
      organization { name slug }
      participantsCount currentStep { name startDate } } }"""
    d = requests.post(
        "https://api.taikai.network/api/graphql",
        json={"query": q}, timeout=20,
    ).json()
    out = []
    for c in d["data"]["challenges"]:
        step = c.get("currentStep") or {}
        org = c.get("organization") or {}
        prize = taikai_prize(c.get("prize"),
                             (c.get("prizeCurrency") or {}).get("name"))
        tags = []
        if prize:
            tags.append(f"premio-{prize}")
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
            "prize": prize,
            "source": "taikai",
        })
    return out


ETHG_CARD = re.compile(
    r"###\s*(?P<body>.+?)\s*(?P<etype>Hackathon|Meetup|Conference|"
    r"Co-?working|Summit|Workshop)\s*\]\((?P<url>https?://[^)\s]+)\)"
)
ETHG_DATE = re.compile(
    r"(?P<mon>[A-Z][a-z]{2})\s+(?P<d1>\d{1,2})(?:st|nd|rd|th)?"
    r"(?:\s*[–—-]\s*(?:(?P<mon2>[A-Z][a-z]{2})\s+)?(?P<d2>\d{1,2})"
    r"(?:st|nd|rd|th)?)?\s*,\s*(?P<year>\d{4})"
)


def parse_ethglobal_md(md: str) -> list[dict]:
    """Cards Jina: `[![Image…](…) ### NOME RANGE1 RANGE2 TIPO](url)`.
    TIPO já classifica (só 'Hackathon' entra); data = 1º range do body.
    A regex âncora em `](url)` — não cruza a fronteira do card como a v1."""
    out = []
    seen = set()
    for m in ETHG_CARD.finditer(md):
        body, etype, url = m.group("body"), m.group("etype"), m.group("url")
        if etype != "Hackathon":
            continue
        dm = ETHG_DATE.search(body)
        name = (body[: dm.start()] if dm else body).strip(" –-,")
        if not dm or not name:
            continue
        mon2 = dm.group("mon2") or dm.group("mon")
        year = dm.group("year")
        start = parse_date(f"{dm.group('mon')} {dm.group('d1')} {year}")
        end = (parse_date(f"{mon2} {dm.group('d2')} {year}")
               if dm.group("d2") else start)
        if not start or (end and _aware(end) < NOW):
            continue  # passado não entra no radar
        slug = slugify(re.sub(r"(?i)\bETHGlobal\b|\d{4}", "", name).strip()
                       or name)
        if slug in seen:
            continue
        seen.add(slug)
        out.append({
            "id": f"ethglobal-{slug}",
            "name": name,
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


def _ethglobal_api_fallback() -> list[dict]:
    """Endpoints conhecidos/tentáveis — hoje 404/403; mantido pra quando
    houver. Retorna [] sem inventar dado."""
    for u in (
        "https://ethglobal.com/api/events",
        "https://ethglobal.com/api/v2/events",
        "https://api.ethglobal.com/events",
    ):
        try:
            r = requests.get(u, timeout=10,
                             headers={"Accept": "application/json"})
            if not r.ok:
                continue
            d = r.json()
            items = (d if isinstance(d, list)
                     else d.get("events") or d.get("data") or [])
            out = []
            for e in items:
                name = e.get("name") or e.get("title")
                start = parse_date(str(e.get("startDate")
                                       or e.get("starts_at") or ""))
                if not name or not start:
                    continue
                slug = slugify(e.get("slug") or name)
                out.append({
                    "id": f"ethglobal-{slug}",
                    "name": name,
                    "organizer": "ETHGlobal",
                    "startsAt": iso(_aware(start)),
                    "endsAt": None,
                    "format": "online" if "online" in name.lower()
                              else "presencial",
                    "location": None,
                    "registrationUrl": e.get("url")
                        or f"https://ethglobal.com/events/{e.get('slug','')}",
                    "registrationDeadline": None,
                    "tags": ["web3", "ethereum"],
                    "source": "ethglobal",
                })
            if out:
                return out
        except Exception:
            continue
    return []


def src_ethglobal() -> list[dict]:
    # página é client-rendered — Jina entrega o texto resolvido
    md = jina("https://ethglobal.com/events")
    out = parse_ethglobal_md(md) if md else []
    if not out:
        out = _ethglobal_api_fallback()
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
    """Geogated hoje (API interna exige place_id real) — mantido pra quando
    resolver; 0 aqui é esperado e logado como degraded."""
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
            "prize": "R$ 15 mil",
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
    ensure_schema(conn)

    collected: list[dict] = []
    print("== coleta ==")
    for name, fn in SOURCES:
        try:
            rows = fn()
        except Exception as e:  # fonte quebrada não derruba o resto
            print(f"[fail] {name:10s} {e}", file=sys.stderr)
            continue
        got = len(rows)
        if name in NEEDS_FILTER:
            rows = [r for r in rows
                    if is_hackathon(r.get("name"), r.get("tags"), None)]
            if got > len(rows):
                print(f"      {name:10s} filtro: -{got - len(rows)} não-hackathon")
        collected += rows
        if not rows and name in ZERO_IS_DEGRADED:
            print(f"[degraded] {name:6s} 0 eventos (fonte instável/geogated —"
                  f" curadoria cobre)")
        else:
            print(f"[ok] {name:10s} {len(rows):3d} eventos")

    winners, merges = dedupe(collected)
    kept, skipped = filter_vs_existing(conn, winners)
    n_up = upsert(conn, kept)
    stale = deactivate_stale_dupes(conn, kept)
    exp = sweep_expired(conn)
    conn.commit()

    print("\n== pipeline ==")
    print(f"dedupe: {len(collected)} coletados → {len(winners)} únicos"
          f" ({merges} merges)")
    if skipped:
        print(f"comunidade: {len(skipped)} raspados skipados"
              f" ({', '.join(r['name'] for r in skipped)})")
    print(f"upsert: {n_up} | dupes antigas desativadas: {stale}"
          f" | expirados varridos: {exp}")
    ext, ext_on = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(active),0) FROM hackathons"
        " WHERE source IS NOT NULL"
    ).fetchone()
    print(f"\nRadar externo no banco: {ext} linhas, {ext_on} ativas")


if __name__ == "__main__":
    main()
