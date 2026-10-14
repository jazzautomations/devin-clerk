"""Radar scraper v2 — puxa hackathons reais de verdade pro HackaHub.

Fontes:
  - Sympla      busca pública via Jina (BR; hackathon, game jam, datathon…)
  - Doity       busca HTML + JSON-LD da página do evento (BR)
  - Shawee      página de inscrições abertas (BR; só avisa quando abre)
  - Devpost     API pública /api/hackathons (paginada: page/per_page)
  - TAIKAI      GraphQL api.taikai.network
  - ETHGlobal   Jina markdown, cards tipados (fallback: endpoints JSON)
  - MLH         HTML via Scrapling (seasons 2026/2027)
  - Meetup      Jina Reader (JS-rendered)
  - Luma        Jina Reader (JS-rendered) — geogated, costuma dar 0
  - Curadoria   BR verificado manualmente

Pipeline: coletar → classificar (hackathon × resto, região) → deduplicar
(dedupe_key = nome normalizado + data de início) → filtrar vs casa
→ upsert (active=0 se expirado, first_seen/last_seen, region) → reconciliar
dupes antigas → desativar recusados/reclassificar o que já estava no banco
→ sweep de expirados.

Uso:
  DATABASE_URL=postgres://… uv run --python .venv-scraper/bin/python scripts/scrape_radar.py
  npm run test:scrape  # pytest (fixtures em scripts/fixtures/radar)

Upsert por id estável: registros nunca são apagados. Edições da casa
(sem `source`, ou gravadas pelo app: 'seed' e 'painel') nunca são alteradas
nem desativadas aqui. Indicação aprovada ('comunidade') e evento de terceiro
posto à mão no admin ('admin') não são reclassificados nem trocados por
raspado, mas saem do ar quando acabam, como o resto do radar.
"""

from __future__ import annotations

import json
import re
import os
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests
from dateutil import parser as dateparser

DATABASE_URL = os.environ.get("DATABASE_URL", "")
NOW = datetime.now(timezone.utc)

DEVPOST_MAX_PAGES = 5
DEVPOST_PER_PAGE = 24
DEVPOST_PAGE_SLEEP = 1.2

# todas as fontes passam pelo classificador (ver "classificação" abaixo);
# ethglobal ainda filtra pelo tipo do card
ZERO_IS_DEGRADED = {"ethglobal", "luma", "sympla", "doity"}  # 0 = log claro
ZERO_IS_NORMAL = {"shawee"}  # só avisa quando abre inscrição


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
    if (currency_name or "").upper() == "BRL":
        return f"R$ {n.replace(',', '.')}"  # real no formato daqui
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


# ---------- classificação: hackathon de verdade × resto ----------
#
# Critério (docs/runbook.md, seção Radar):
#   1. Termo de hackathon no nome (ou na descrição, quando a fonte manda):
#      hackathon/hackaton, hacka*, hack day, datathon, ideathon, buildathon,
#      makeathon, designathon, game jam, maratona de programação/inovação,
#      desafio de inovação, NASA Space Apps.
#   2. Palavra de "isso é sobre um hackathon, não é o hackathon" ANTES do
#      termo derruba: "Workshop preparatório pro Hackathon X", "Abertura da
#      Game Jam", "Learn to Hack". "Data Summit — Hackathon oficial" passa.
#   3. Fontes de busca genérica (Meetup, Sympla, Doity, Luma) exigem o termo:
#      nome neutro tipo "30º BitDevs BH" ou "Front @ Uber" fica de fora.
#   4. Fontes que só listam hackathon (Devpost, TAIKAI, ETHGlobal, MLH)
#      aceitam nome neutro, mas tiram o lixo: projeto de disciplina ("Senior
#      Design", "capstone"), prêmio irrisório (< US$ 200 somando tudo),
#      organizador vazio ("nill") e Devpost com menos de 10 inscritos.
#   5. Curadoria é verificada à mão e não passa pelo filtro.

HACK_RE = re.compile(
    r"(?i)hack|datathon|buildathon|ideathon|makeathon|designathon|"
    r"game\s?jam|\bjam\b|codefest|"
    r"maratona\s+(?:de\s+)?(?:programa|inova|hack|tecnolog|dados|ideias|"
    r"empreendedorismo|solu)|"
    r"desafio\s+(?:de\s+)?inova|space\s+apps"
)
# "sobre o hackathon" e não o hackathon: só derruba se vier ANTES do termo
PRE_DENY_RE = re.compile(
    r"(?i)\b(curso|aula|workshop|oficina|palestra|webinar|live|mentoria|"
    r"abertura|encerramento|cerim[ôo]nia|premia[çc][ãa]o|resultado|"
    r"aquecimento|prepara[çc][ãa]o|preparat[óo]ri[oa]|dicas|"
    r"como\s+(?:vencer|participar|ganhar|montar)|learn\s+to|"
    r"introdu[çc][ãa]o|mentor(?:es|as)?|jurad[oa]s?|volunt[áa]ri[oa]s?)\b"
)
DENY_RE = re.compile(
    r"(?i)\b(conference|summit|congresso|congress|meetup|meet-?up|talk|"
    r"workshop|feira|webinar|co-?working|seminar|semin[aá]rio|encontro|"
    r"pizza party|happy hour|retrospectiva|curso|aula|palestra|mentoria|"
    r"mentorship|bootcamp|imers[ãa]o|forma[çc][ãa]o|introdu[çc][ãa]o|"
    r"learning group|bitdevs|day)\b"
)
COURSE_RE = re.compile(
    r"(?i)senior\s+design|capstone|\bcourse\b|\bsemester\b|homework|"
    r"\bdisciplina\b|\bESE\b"
)
PLACEHOLDER_ORG = {"", "nill", "nil", "null", "none", "n/a", "na", "-",
                   "test", "teste", "tbd"}

STRICT_SOURCES = {"meetup", "sympla", "doity", "luma"}
NATIVE_SOURCES = {"devpost", "taikai", "ethglobal", "mlh"}
# Edições da casa, com página e inscrição no HackaHub: linhas antigas sem
# source, o seed (lib/seed.ts → 'seed') e o painel (POST
# /api/admin/hackathons → 'painel'). O scraper não mexe nelas em nada.
EDITION_SOURCES = ("seed", "painel")
EDITION_WHERE = "(source IS NULL OR source IN ({}))".format(
    ", ".join(f"'{s}'" for s in EDITION_SOURCES))
# fontes da casa: nunca reclassificadas nem desativadas como dupe
HOUSE_SOURCES = {"curadoria", "comunidade", "admin", *EDITION_SOURCES}

MIN_PRIZE_USD = 200
DEVPOST_MIN_REGISTRATIONS = 10
# câmbio aproximado só pra comparar ordem de grandeza (nunca exibido)
USD_RATE = {"R$": 0.18, "US$": 1.0, "$": 1.0, "€": 1.1, "£": 1.3,
            "₹": 0.012, "C$": 0.73, "A$": 0.65, "¥": 0.0067}


def prize_usd(prize: str | None) -> float | None:
    """'₹ 1,000' → 12.0; '$30' → 30.0; 'R$ 15 mil' → 2700.0. None = sem dado."""
    if not prize:
        return None
    s = prize.strip()
    sym = next((k for k in sorted(USD_RATE, key=len, reverse=True)
                if s.startswith(k)), None)
    if not sym:
        return None
    num = s[len(sym):].strip()
    mult = 1000 if re.search(r"(?i)\bmil\b|k$", num) else 1
    digits = re.sub(r"[^\d]", "", re.sub(r"[.,]\d{2}$", "", num))
    if not digits:
        return None
    return int(digits) * mult * USD_RATE[sym]


def _hack_pos(text: str) -> int:
    m = HACK_RE.search(text or "")
    return m.start() if m else -1


def is_hackathon(name: str, tags=None, description: str | None = None,
                 strict: bool = False) -> bool:
    """Só hackathon de verdade entra no radar (critério no topo da seção).

    Termo de hack no nome/tags/descrição aceita, salvo palavra de "evento
    sobre o hackathon" antes dele no nome. Sem termo: `strict` rejeita;
    senão a denylist decide (neutro passa — "NASA Space Apps Challenge").
    Denylist não olha `tags`: a tag 'meetup' é rótulo nosso, não do evento.
    """
    pos = _hack_pos(name)
    if pos >= 0:
        pre = PRE_DENY_RE.search(name[:pos])
        return not pre
    hay = " ".join([" ".join(tags or []), description or ""])
    if HACK_RE.search(hay):
        # descrição/tag fala de hackathon: vale, salvo nome de palestra/curso
        return not DENY_RE.search(name or "")
    if strict:
        return False
    return not DENY_RE.search(" ".join([name or "", description or ""]))


def classify(row: dict, description: str | None = None) -> str | None:
    """None = entra; senão o motivo da recusa (vai pro log e pro banco)."""
    src = (row.get("source") or "").split("+")[0]
    if src in HOUSE_SOURCES:
        return None
    name = row.get("name") or ""
    if src in NATIVE_SOURCES:
        # a fonte só lista hackathon: nome neutro ("Syntax Summit") passa,
        # mas "Learn to Hack" (curso sobre hack) não
        pos = _hack_pos(name)
        if pos >= 0 and PRE_DENY_RE.search(name[:pos]):
            return "nao-hackathon"
    elif not is_hackathon(name, row.get("tags"), description,
                          strict=src in STRICT_SOURCES):
        return "nao-hackathon"
    if COURSE_RE.search(name):
        return "disciplina"
    if src in NATIVE_SOURCES:
        org = (row.get("organizer") or "").strip().lower()
        if org in PLACEHOLDER_ORG:
            return "organizador-vazio"
        usd = prize_usd(row.get("prize"))
        if usd is not None and usd < MIN_PRIZE_USD:
            return "premio-irrisorio"
        regs = row.get("registrations")
        if (src == "devpost" and regs is not None
                and regs < DEVPOST_MIN_REGISTRATIONS):
            return "sem-inscritos"
    return None


# ---------- região: Brasil primeiro ----------
#
# br            presencial/híbrido no Brasil (cidade/UF reconhecida)
# online-br     online com organizador brasileiro ou em português
# online-mundo  online, de fora
# exterior      presencial fora do Brasil
# Espelho de lib/radar.ts (o app deriva igual quando a coluna está vazia).

UFS = {"ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt",
       "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro",
       "rr", "sc", "sp", "se", "to"}
BR_PLACE_RE = re.compile(
    r"(?i)\b(brasil|brazil|s[ãa]o paulo|rio de janeiro|belo horizonte|"
    r"porto alegre|florian[óo]polis|curitiba|recife|salvador|fortaleza|"
    r"bras[íi]lia|manaus|bel[ée]m|goi[âa]nia|campinas|sorocaba|niter[óo]i|"
    r"alphaville|macei[óo]|natal|jo[ãa]o pessoa|teresina|aracaju|cuiab[áa]|"
    r"campo grande|vit[óo]ria|s[ãa]o lu[íi]s|palmas|porto velho|macap[áa]|"
    r"boa vista|rio branco|uberl[âa]ndia|joinville|blumenau|londrina|"
    r"ribeir[ãa]o preto|santos|s[ãa]o carlos|s[ãa]o jos[ée] dos campos)\b"
)
# português, sem confundir com espanhol (que não tem ã/õ nem "ção")
PT_RE = re.compile(
    r"(?i)[ãõ]|ç[ãõ]|\b(dos|das|nas|nos|pra|você|edição|inscriç\w*|"
    r"maratona|soluç\w*|inovaç\w*|tecnologia|saúde|educação)\b"
)
BR_SOURCES = {"sympla", "doity", "curadoria", "comunidade", "admin", "meetup",
              *EDITION_SOURCES}


def is_br_location(loc: str | None) -> bool:
    if not loc:
        return False
    tail = re.search(r",\s*([A-Za-z]{2})[\s./-]*$", loc)
    if tail and tail.group(1).lower() in UFS:
        return True
    if re.search(r"\bBR\b", loc):
        return True
    return bool(BR_PLACE_RE.search(loc))


def region_of(row: dict) -> str:
    loc = row.get("location")
    srcs = set((row.get("source") or "").split("+"))
    br_src = bool(srcs & BR_SOURCES)
    if is_br_location(loc):
        return "br"
    if row.get("format") != "online":
        # presencial sem local vindo de fonte brasileira é Brasil
        return "br" if (br_src and not loc) else "exterior"
    pt = PT_RE.search(row.get("name") or "")
    brl = (row.get("prize") or "").startswith("R$")
    return "online-br" if (br_src or pt or brl) else "online-mundo"


def is_expired(row: dict, now: datetime | None = None) -> bool:
    # spec 027 — mesma COALESCE do radar: endsAt → registrationDeadline →
    # startsAt. Evento cuja janela abriu mas não fechou (Devpost usa
    # startsAt = abertura da submissão) NÃO expira enquanto roda.
    dt = parse_date(
        row.get("endsAt") or row.get("registrationDeadline")
        or row.get("startsAt") or "")
    return bool(dt) and _aware(dt) < (now or NOW)


# ---------- schema / persistência ----------

class PgConn:
    """Conexão Postgres com a cara do sqlite3 que o scraper usava: aceita
    `?` e `@nome`, cita identificadores camelCase (mesma regra de lib/db.ts)."""

    _tok = re.compile(r"'(?:[^']|'')*'|\"[^\"]*\"|\?|@[A-Za-z_]\w*|[A-Za-z_]\w*|.", re.S)

    def __init__(self, conn):
        self.conn = conn

    @classmethod
    def translate(cls, sql: str, has_params: bool = True) -> str:
        out = []
        for t in cls._tok.findall(sql):
            if t == "?":
                out.append("%s")
            elif t.startswith("@"):
                out.append(f"%({t[1:]})s")
            elif t[0].isalpha() and re.search("[a-z]", t) and re.search("[A-Z]", t):
                out.append(f'"{t}"')
            elif t == "%" and has_params:
                out.append("%%")  # psycopg só interpola quando há params
            else:
                out.append(t)
        return "".join(out)

    def execute(self, sql: str, params=None):
        return self.conn.execute(self.translate(sql, params is not None), params)

    def commit(self) -> None:
        self.conn.commit()


def ensure_schema(conn) -> None:
    """Schema é das migrations (migrations/*.sql, aplicadas pelo app no boot).
    Aqui só o backfill de timestamps em linhas antigas."""
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
   region, excludedReason, first_seen, last_seen)
VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location,
   @registrationUrl, @registrationDeadline, @tags, @active, @source,
   @prize, @region, NULL, @now, @now)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name, organizer=excluded.organizer,
  startsAt=excluded.startsAt, endsAt=excluded.endsAt,
  format=excluded.format, location=excluded.location,
  registrationUrl=excluded.registrationUrl,
  registrationDeadline=excluded.registrationDeadline,
  tags=excluded.tags, active=excluded.active, source=excluded.source,
  prize=excluded.prize, region=excluded.region, excludedReason=NULL,
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
        r["region"] = r.get("region") or region_of(r)
        r["now"] = NOW.isoformat()
        conn.execute(UPSERT_SQL, r)
        n += 1
    return n


# linhas que o scraper nunca mexe por dedupe: edições da casa
# (EDITION_WHERE), indicação aprovada (comunidade) e evento de terceiro posto
# à mão no admin
HOUSE_WHERE = "(source IS NULL OR source IN ({}))".format(
    ", ".join(f"'{s}'" for s in ("comunidade", "admin", *EDITION_SOURCES)))


def filter_vs_existing(conn, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Raspado cuja chave já existe na casa (HOUSE_WHERE)
    é skipado — o evento da casa é autoridade, e inserir criaria dupe."""
    community = {
        dedupe_key({"name": n, "startsAt": s})
        for n, s in conn.execute(
            f"SELECT name, startsAt FROM hackathons WHERE {HOUSE_WHERE}"
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
        f" WHERE NOT {HOUSE_WHERE} AND active = 1"
    ):
        wid = win_ids.get(dedupe_key({"name": name, "startsAt": starts}))
        if wid and wid != rid:
            conn.execute("UPDATE hackathons SET active=0 WHERE id=?", (rid,))
            n += 1
    return n


def exclude_rejected(conn, rejected: list[tuple[dict, str]]) -> int:
    """Recusado pelo classificador que já estava no banco (rodada antiga,
    critério mais frouxo) → active=0 com o motivo. Nunca DELETE; casa intacta."""
    n = 0
    for r, reason in rejected:
        cur = conn.execute(
            "UPDATE hackathons SET active=0, excludedReason=?"
            f" WHERE id=? AND active=1 AND NOT {HOUSE_WHERE}"
            " AND source <> 'curadoria'",
            (reason, r["id"]),
        )
        n += cur.rowcount
    return n


def reclassify_existing(conn) -> tuple[int, int]:
    """Passa o critério atual nas linhas ativas que esta rodada não viu
    (Meetup muda a busca todo dia; o que entrou ontem fica). Só olha o que
    o banco guarda: nome, organizador, prêmio. Também preenche região vazia.
    Retorna (desativadas, regiões preenchidas)."""
    off = filled = 0
    rows = conn.execute(
        "SELECT id, name, organizer, format, location, prize, source, region"
        f" FROM hackathons WHERE active=1 AND NOT {EDITION_WHERE}"
    ).fetchall()
    for rid, name, org, fmt, loc, prize, src, region in rows:
        row = {"id": rid, "name": name, "organizer": org, "format": fmt,
               "location": loc, "prize": prize, "source": src}
        first = (src or "").split("+")[0]
        reason = (classify(row) if first in STRICT_SOURCES | NATIVE_SOURCES
                  else None)
        if reason:
            conn.execute(
                "UPDATE hackathons SET active=0, excludedReason=? WHERE id=?",
                (reason, rid),
            )
            off += 1
        elif not region:
            conn.execute("UPDATE hackathons SET region=? WHERE id=?",
                         (region_of(row), rid))
            filled += 1
    return off, filled


def sweep_expired(conn) -> int:
    """Externos encerrados → active=0 (spec 027: COALESCE com deadline de
    inscrição — mesmo critério do radar). Edições da casa (EDITION_WHERE)
    ficam no ar depois de acabar: página, resultado e certificados."""
    cur = conn.execute(
        f"""UPDATE hackathons SET active=0
           WHERE NOT {EDITION_WHERE} AND active=1
             AND to_ts(COALESCE(endsAt, registrationDeadline, startsAt))
                 < now()"""
    )
    return cur.rowcount


# ---------- fontes ----------

# Temas do Devpost em PT-BR. O que não está aqui fica de fora: pedaço solto
# de tema ("low", "open") e tema genérico não ajudam a filtrar. O prêmio já
# tem campo próprio e não vira tag. Mesmo dicionário de lib/radarTags.ts.
DEVPOST_THEMES = {
    "machine learning/ai": "ia",
    "beginner friendly": "iniciante",
    "health": "saúde",
    "education": "educação",
    "gaming": "jogos",
    "social good": "impacto social",
    "web": "web",
    "blockchain": "web3",
    "fintech": "fintech",
    "iot": "iot",
    "design": "design",
    "productivity": "produtividade",
    "communication": "comunicação",
    "ar/vr": "ar/vr",
    "cybersecurity": "segurança",
    "databases": "dados",
    "devops": "devops",
    "mobile": "mobile",
    "music/art": "arte",
    "quantum": "computação quântica",
    "e-commerce/retail": "varejo",
    "government": "governo",
    "robotic process automation": "automação",
    "voice skills": "voz",
}


def devpost_tags(themes) -> list[str]:
    """Temas do Devpost → até 3 tags em PT-BR, sem repetir e sem desconhecidos."""
    out: list[str] = []
    for name in themes:
        tag = DEVPOST_THEMES.get((name or "").strip().lower())
        if tag and tag not in out:
            out.append(tag)
    return out[:3]


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
            tags = devpost_tags(t.get("name") for t in h.get("themes", []))
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
                "registrations": h.get("registrations_count"),
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
        # o prêmio tem campo próprio; virar tag "premio-$1,000" só polui o filtro
        tags: list[str] = []
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


# ---------- fontes brasileiras ----------

UA = ("Mozilla/5.0 (compatible; HackaHubRadar/1.0; "
      "+https://hackahub.jazzautomations.com.br)")
PT_MONTHS = {"jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
             "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12}
BRT = "-03:00"


def _year_for(month: int, day: int, now: datetime) -> int:
    """Card sem ano ("31 de Out"): o ano em que a data não ficou mais de
    60 dias pra trás — a busca só mostra evento futuro ou rolando."""
    y = now.year
    try:
        d = datetime(y, month, day, tzinfo=timezone.utc)
    except ValueError:
        return y
    return y + 1 if (now - d).days > 60 else y


def parse_pt_dates(text: str, now: datetime | None = None):
    """'Sábado, 31 de Out às 16:00' | '06 de Out a 16 de Nov' |
    '21 de out. de 2026' → (startsAt, endsAt) ISO com fuso de Brasília."""
    now = now or NOW
    t = text.strip().lower()
    m = re.search(
        r"(\d{1,2}) de (\w{3})\.?(?: de (\d{4}))? a (\d{1,2}) de (\w{3})\.?"
        r"(?: de (\d{4}))?", t)
    if m and m.group(2) in PT_MONTHS and m.group(5) in PT_MONTHS:
        d1, m1, d2, m2 = (int(m.group(1)), PT_MONTHS[m.group(2)],
                          int(m.group(4)), PT_MONTHS[m.group(5)])
        y1 = int(m.group(3) or 0) or _year_for(m1, d1, now)
        y2 = int(m.group(6) or 0) or (y1 + 1 if m2 < m1 else y1)
        return (f"{y1:04d}-{m1:02d}-{d1:02d}T09:00:00{BRT}",
                f"{y2:04d}-{m2:02d}-{d2:02d}T18:00:00{BRT}")
    m = re.search(
        r"(\d{1,2}) de (\w{3})\.?(?: de (\d{4}))?(?: às (\d{1,2}):(\d{2}))?", t)
    if m and m.group(2) in PT_MONTHS:
        d1, m1 = int(m.group(1)), PT_MONTHS[m.group(2)]
        y1 = int(m.group(3) or 0) or _year_for(m1, d1, now)
        hh, mm = (int(m.group(4)), int(m.group(5))) if m.group(4) else (9, 0)
        day = f"{y1:04d}-{m1:02d}-{d1:02d}"
        # dia único: fica aberto até o fim do dia, não some na hora do início
        return f"{day}T{hh:02d}:{mm:02d}:00{BRT}", f"{day}T23:59:00{BRT}"
    return None, None


SYMPLA_TERMS = ("hackathon", "hackaton", "game jam", "datathon", "space apps")
SYMPLA_CARD = re.compile(
    r"\[!\[Image \d+: Imagem do evento (?P<alt>[^\]]*)\]\([^)]*\)\s*###\s*"
    r"(?P<body>.+?)\]\((?P<url>https://www\.sympla\.com\.br/"
    r"(?P<kind>evento|evento-online)/(?P<slug>[^/\s]+)/(?P<eid>\d+))[^)]*\)"
)
SYMPLA_DATE = re.compile(
    r"\s((?:(?:segunda|terça|quarta|quinta|sexta|sábado|domingo),\s*)?"
    r"\d{1,2} de \w{3}(?: às \d{1,2}:\d{2}| a \d{1,2} de \w{3})?)$",
    re.I,
)


def _name_by_slug(head: str, slug: str) -> str | None:
    """Maior prefixo do texto cujo slug bate com o da URL."""
    words = head.split()
    best = None
    for i in range(1, len(words) + 1):
        pre = " ".join(words[:i])
        sl = slugify(unicodedata.normalize("NFKD", pre)
                     .encode("ascii", "ignore").decode())
        if sl and slug.startswith(sl):
            best = pre
            if sl == slug:
                break
    return best


def parse_sympla_md(md: str, now: datetime | None = None) -> list[dict]:
    """Cards da busca do Sympla renderizada pelo Jina:
    `[![Image N: Imagem do evento ALT](img) ### NOME LOCAL - Cidade, UF DATA](url)`.
    O alt da imagem às vezes é de outro evento (imagem reaproveitada), então
    o nome só vale se o texto começar com ele; senão vem do slug da URL."""
    out, seen = [], set()
    for m in SYMPLA_CARD.finditer(md):
        eid = m.group("eid")
        if eid in seen:
            continue
        seen.add(eid)
        body = " ".join(m.group("body").split())
        dm = SYMPLA_DATE.search(body)
        if not dm:
            continue
        start, end = parse_pt_dates(dm.group(1), now)
        if not start:
            continue
        rest = body[: dm.start()].strip()
        online = m.group("kind") == "evento-online" or rest.endswith(
            "Evento Online")
        location = None
        if online:
            head = re.sub(r"\s*Evento Online$", "", rest)
        else:
            lm = re.match(r"^(?P<head>.*) - (?P<city>[^-]+?), (?P<uf>[A-Z]{2})$",
                          rest)
            if not lm:
                continue
            head = lm.group("head")
            city, uf = lm.group("city").strip(), lm.group("uf")
        alt = " ".join(m.group("alt").split())
        if alt and norm_name(head).startswith(norm_name(alt)):
            name = alt
        else:
            name = _name_by_slug(head, m.group("slug")) or alt or head
        if not online:
            venue = head[len(name):].strip(" -")
            location = ", ".join(p for p in (venue, city, uf) if p)
        out.append({
            "id": f"sympla-{eid}",
            "name": name.strip(),
            "organizer": "via Sympla",
            "startsAt": start,
            "endsAt": end,
            "format": "online" if online else "presencial",
            "location": location,
            "registrationUrl": m.group("url"),
            "registrationDeadline": None,
            "tags": [],
            "source": "sympla",
        })
    return out


def src_sympla() -> list[dict]:
    """Busca pública do Sympla (robots: Allow /). A página monta a lista no
    browser, então vai pelo Jina como o Meetup — uma página por termo."""
    out, seen = [], set()
    for term in SYMPLA_TERMS:
        md = jina("https://www.sympla.com.br/eventos?s="
                  + requests.utils.quote(term))
        for r in parse_sympla_md(md):
            if r["id"] not in seen:
                seen.add(r["id"])
                out.append(r)
        time.sleep(3)
    return out


DOITY_TERMS = ("hackathon", "maratona", "game jam", "datathon", "ideathon")
DOITY_CARD = re.compile(
    r'<li><a href="(?P<url>https://doity\.com\.br/[^"]+)"[^>]*>.*?'
    r"<h2[^>]*>(?P<title>.*?)</h2><p[^>]*>(?P<meta>.*?)</p>", re.S)


def parse_doity_cards(html_text: str) -> list[dict]:
    """Cards da busca (HTML do servidor): url, título, 'data · Cidade, UF'."""
    import html as htmllib
    out = []
    for m in DOITY_CARD.finditer(html_text):
        meta = htmllib.unescape(re.sub(r"<!--.*?-->|<[^>]+>", "", m.group("meta")))
        out.append({
            "url": m.group("url"),
            "title": " ".join(htmllib.unescape(
                re.sub(r"<[^>]+>", "", m.group("title"))).split()),
            "meta": " ".join(meta.split()),
        })
    return out


def _doity_dt(s: str | None) -> str | None:
    """'2026-10-21-0313:00' (data + fuso + hora colados) → ISO."""
    if not s:
        return None
    m = re.match(r"(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2}:\d{2})$", s)
    if m:
        return f"{m.group(1)}T{m.group(3)}:00-{m.group(2)}:00"
    dt = parse_date(s)
    return iso(dt) if dt else None


def parse_doity_event(html_text: str) -> dict | None:
    """JSON-LD schema.org/Event da página do evento."""
    import html as htmllib
    for m in re.finditer(
            r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>',
            html_text, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if not isinstance(d, dict) or d.get("@type") != "Event":
            continue
        place = d.get("location") or {}
        addr = place.get("address") or {} if isinstance(place, dict) else {}
        mode = d.get("eventAttendanceMode") or ""
        fmt = ("online" if "Online" in mode
               else "hibrido" if "Mixed" in mode else "presencial")
        loc = None
        if fmt != "online":
            loc = ", ".join(p for p in (
                place.get("name") if isinstance(place, dict) else None,
                addr.get("addressLocality"), addr.get("addressRegion"),
            ) if p) or None
        desc = re.sub(r"<[^>]+>", " ", htmllib.unescape(d.get("description") or ""))
        return {
            "name": " ".join((d.get("name") or "").split()),
            "organizer": (d.get("organizer") or {}).get("name"),
            "startsAt": _doity_dt(d.get("startDate")),
            "endsAt": _doity_dt(d.get("endDate")),
            "format": fmt,
            "location": loc,
            "url": d.get("url"),
            "description": " ".join(desc.split()),
        }
    return None


def src_doity() -> list[dict]:
    """Busca do Doity (robots: Allow /) renderizada no servidor. Só abre a
    página (JSON-LD) dos cards cujo título já parece hackathon."""
    out, seen = [], set()
    for term in DOITY_TERMS:
        r = requests.get("https://doity.com.br/eventos",
                         params={"q": term}, headers={"User-Agent": UA},
                         timeout=20)
        if not r.ok:
            continue
        for c in parse_doity_cards(r.text):
            if c["url"] in seen or not HACK_RE.search(c["title"]):
                continue
            seen.add(c["url"])
            time.sleep(1.5)
            page = requests.get(c["url"], headers={"User-Agent": UA},
                                timeout=20)
            ev = parse_doity_event(page.text) if page.ok else None
            if not ev or not ev["startsAt"]:
                continue
            slug = c["url"].rstrip("/").rsplit("/", 1)[-1]
            out.append({
                "id": f"doity-{slug[:60]}",
                "name": ev["name"] or c["title"],
                "organizer": ev["organizer"] or "via Doity",
                "startsAt": ev["startsAt"],
                "endsAt": ev["endsAt"],
                "format": ev["format"],
                "location": ev["location"],
                "registrationUrl": ev["url"] or c["url"],
                "registrationDeadline": None,
                "tags": [],
                "source": "doity",
                "_description": ev["description"][:2000],
            })
        time.sleep(2)
    return out


def src_shawee() -> list[dict]:
    """Shawee (plataforma brasileira de hackathon) tem página de inscrições
    abertas em WordPress. Hoje diz "Não há inscrições abertas"; quando mudar,
    o log avisa pra curadoria olhar à mão — não há card real pra parsear."""
    r = requests.get("https://shawee.io/pt/inscricoes-abertas/",
                     headers={"User-Agent": UA}, timeout=20)
    # o servidor não manda charset; requests cairia em latin-1
    if r.ok and "inscrições abertas no momento" not in r.content.decode(
            "utf-8", "replace"):
        print("[aviso] shawee tem inscrições abertas — curadoria, olha à mão:"
              " https://shawee.io/pt/inscricoes-abertas/")
    return []


# fontes testadas que não dá pra ler sem burlar proteção — entram no log
BLOCKED_SOURCES = {
    "even3": "busca pede reCAPTCHA (POST /auxiliar/retornarlistaevento)",
    "eventbrite": "responde 405 pra robô, inclusive via Jina",
}


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
    ("sympla", src_sympla),
    ("doity", src_doity),
    ("shawee", src_shawee),
    ("devpost", src_devpost),
    ("taikai", src_taikai),
    ("ethglobal", src_ethglobal),
    ("mlh", src_mlh),
    ("meetup", src_meetup),
    ("luma", src_luma),
    ("curadoria", src_curated),
]


def collect(sources=None) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Roda as fontes e classifica. Retorna (aceitos, [(recusado, motivo)])."""
    collected: list[dict] = []
    rejected: list[tuple[dict, str]] = []
    print("== coleta ==")
    for name in BLOCKED_SOURCES:
        print(f"[degraded] {name:10s} fora: {BLOCKED_SOURCES[name]}")
    for name, fn in sources or SOURCES:
        try:
            rows = fn()
        except Exception as e:  # fonte quebrada não derruba o resto
            print(f"[fail] {name:10s} {e}", file=sys.stderr)
            continue
        got = len(rows)
        kept, why = [], {}
        for r in rows:
            reason = classify(r, r.pop("_description", None))
            if reason:
                rejected.append((r, reason))
                why[reason] = why.get(reason, 0) + 1
            else:
                r["region"] = region_of(r)
                kept.append(r)
        if why:
            print(f"      {name:10s} recusados: "
                  + ", ".join(f"{k} {v}" for k, v in sorted(why.items())))
        collected += kept
        if not kept and name in ZERO_IS_NORMAL:
            print(f"[ok] {name:10s}   0 eventos (sem inscrição aberta)")
        elif not kept and name in ZERO_IS_DEGRADED:
            print(f"[degraded] {name:6s} 0 eventos de {got} lidos"
                  f" (fonte instável/geogated — curadoria cobre)")
        else:
            by_region: dict[str, int] = {}
            for r in kept:
                by_region[r["region"]] = by_region.get(r["region"], 0) + 1
            regs = ", ".join(f"{k} {v}" for k, v in sorted(by_region.items()))
            print(f"[ok] {name:10s} {len(kept):3d} eventos"
                  + (f" ({regs})" if regs else ""))
    return collected, rejected


def main() -> None:
    if not DATABASE_URL:
        sys.exit("DATABASE_URL não definida (postgres://…)")
    import psycopg
    conn = PgConn(psycopg.connect(DATABASE_URL))
    ensure_schema(conn)

    collected, rejected = collect()
    winners, merges = dedupe(collected)
    kept, skipped = filter_vs_existing(conn, winners)
    n_up = upsert(conn, kept)
    stale = deactivate_stale_dupes(conn, kept)
    n_rej = exclude_rejected(conn, rejected)
    n_old, n_reg = reclassify_existing(conn)
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
    print(f"recusados que estavam no ar: {n_rej} | reclassificados: {n_old}"
          f" | região preenchida: {n_reg}")
    ext, ext_on = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(active),0) FROM hackathons"
        f" WHERE NOT {EDITION_WHERE}"
    ).fetchone()
    print(f"\nRadar externo no banco: {ext} linhas, {ext_on} ativas")
    for region, n in conn.execute(
        "SELECT COALESCE(region, '?'), COUNT(*) FROM hackathons"
        f" WHERE active=1 AND NOT {EDITION_WHERE}"
        "   AND to_ts(COALESCE(endsAt, registrationDeadline, startsAt)) >= now()"
        " GROUP BY 1 ORDER BY 1"
    ):
        print(f"  aberto · {region:12s} {n}")


if __name__ == "__main__":
    main()
