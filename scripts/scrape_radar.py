"""Radar scraper v3 — puxa hackathons reais, do Brasil e do mundo, pro HackaHub.

Fontes (docs/runbook.md, seção Radar, tem o status de cada uma):
  Brasil
  - Sympla      busca pública via Jina (hackathon, game jam, datathon…)
  - Doity       busca HTML + JSON-LD da página do evento
  - Shawee      página de inscrições abertas (só avisa quando abre)
  - Meetup      Jina Reader, 3 cidades
  - Curadoria   verificado à mão
  Mundo
  - Devpost     API pública /api/hackathons (abertos + em breve, todas as
                páginas) + página de cada um pra ler "Who can participate"
  - Luma        API pública do discover (busca por termo, SP/RJ e
                calendários de comunidade)
  - ETHGlobal   payload do Next na página /events
  - MLH         JSON da página da temporada (www.mlh.com)
  - Devfolio    API pública de busca
  - lablab.ai   payload do Next na página /ai-hackathons
  - Hack Club   API pública hackathons.hackclub.com
  - TAIKAI      GraphQL api.taikai.network

Pipeline: coletar → classificar (hackathon × resto) → alcance, região,
elegibilidade e marca → deduplicar (nome normalizado + data de início) →
filtrar vs casa → upsert → reconciliar dupes antigas → desativar
recusados/reclassificar o que já estava no banco → sweep de expirados.

Elegibilidade (brazilOk): 'sim' ou 'nao' só com evidência — a regra da
fonte (Devpost "Who can participate") ou o evento acontecer no Brasil.
Sem evidência fica None ("não informado"). Nunca chuta "sim".

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

# Devpost: a API pública pagina em 40; abertos + em breve dão ~190 hoje.
# Teto de páginas só pra não rodar sem fim se a API mudar.
DEVPOST_MAX_PAGES = 10
DEVPOST_PER_PAGE = 40
DEVPOST_PAGE_SLEEP = 1.2
# página de cada hackathon (elegibilidade): no máximo N por rodada, 1 req/s.
# O resultado fica no banco (eligibilityCheckedAt) e só é relido depois de
# DEVPOST_ELIG_TTL_DAYS — a 2ª rodada do dia quase não abre página.
DEVPOST_ELIG_MAX_FETCH = 120
DEVPOST_ELIG_SLEEP = 1.0
DEVPOST_ELIG_TTL_DAYS = 3
SLEEP = 1.0  # entre requisições da mesma fonte

# todas as fontes passam pelo classificador (ver "classificação" abaixo)
ZERO_IS_DEGRADED = {"ethglobal", "luma", "sympla", "doity", "devpost", "mlh",
                    "marcas"}
ZERO_IS_NORMAL = {"shawee", "lablab", "devfolio", "hackclub"}

# cache de elegibilidade lido do banco antes da coleta (main): id → campos
ELIG_CACHE: dict[str, dict] = {}


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


MERGE_FIELDS = (
    "organizer", "endsAt", "format", "location",
    "registrationUrl", "registrationDeadline", "prize",
    "submissionDeadline", "brazilOk", "eligibilityNote", "eligibilityUrl",
    "eligibilityCheckedAt", "scope", "country", "brand",
)


def metadata_score(row: dict) -> float:
    s = sum(1 for f in MERGE_FIELDS if row.get(f))
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
        for f in MERGE_FIELDS:
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
#   4. Fontes que só listam hackathon (Devpost, TAIKAI, ETHGlobal, MLH,
#      Devfolio, lablab, Hack Club) aceitam nome neutro, mas tiram o lixo:
#      projeto de disciplina ("Senior Design", "capstone"), organizador
#      vazio ("nill"), evento só pra membros de uma faculdade/clube
#      (Devpost "SMU BIA members"), prêmio irrisório (< US$ 200) quando
#      quase ninguém se inscreveu (< 100) e Devpost com menos de 10
#      inscritos sem prêmio nem destaque. Prêmio pequeno com muita gente
#      inscrita fica: é hackathon global de verdade.
#   5. Curadoria é verificada à mão e não passa pelo filtro.

HACK_RE = re.compile(
    r"(?i)hack|datathon|buildathon|ideathon|makeathon|designathon|"
    r"(?:game|code|coding|hack|ai|dev|data|design|build|women)\s?jam\b|codefest|"
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
NATIVE_SOURCES = {"devpost", "taikai", "ethglobal", "mlh", "devfolio",
                  "lablab", "hackclub", "marcas"}
# Edições da casa, com página e inscrição no HackaHub: linhas antigas sem
# source, o seed (lib/seed.ts → 'seed') e o painel (POST
# /api/admin/hackathons → 'painel'). O scraper não mexe nelas em nada.
EDITION_SOURCES = ("seed", "painel")
EDITION_WHERE = "(source IS NULL OR source IN ({}))".format(
    ", ".join(f"'{s}'" for s in EDITION_SOURCES))
# fontes da casa: nunca reclassificadas nem desativadas como dupe
HOUSE_SOURCES = {"curadoria", "comunidade", "admin", *EDITION_SOURCES}

MIN_PRIZE_USD = 200
MIN_REGS_FOR_SMALL_PRIZE = 100
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
        if row.get("restrictedTo"):
            return "publico-restrito"
        usd = prize_usd(row.get("prize"))
        regs = row.get("registrations")
        if (usd is not None and usd < MIN_PRIZE_USD
                and (regs is None or regs < MIN_REGS_FOR_SMALL_PRIZE)):
            return "premio-irrisorio"
        if (src == "devpost" and regs is not None
                and regs < DEVPOST_MIN_REGISTRATIONS
                and not row.get("prize") and not row.get("featured")):
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
    country = country_pt(row.get("country"))
    if country == "Brasil":
        return "br"
    # país explícito de fora manda: "Cluj-Napoca, RO" é Romênia, não Rondônia
    if not country and is_br_location(loc):
        return "br"
    online = row.get("format") == "online" or (
        # híbrido sem cidade (lablab: online + sede lá fora) dá pra fazer
        # de casa: conta como online
        row.get("format") == "hibrido" and not loc and not br_src)
    if not online:
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


# ---------- elegibilidade: brasileiro pode participar? ----------
#
# 'sim' / 'nao' só com evidência; None = não informado. A nota guarda o
# trecho da regra (no idioma da fonte) pra pessoa conferir.
#
# Devpost, bloco "Who can participate" da página do hackathon:
#   "All countries/territories, excluding <lista>"   → nao se Brazil na lista
#   "Specific countries/territories excluded" <lista> → idem (lista no
#                                         tooltip ou no modal da página)
#   "Only specific countries/territories included" <lista> → sim só se Brazil
#   "US only" / "Canada only"                         → nao
# A "standard exceptions" do Devpost inclui o Brasil (lei de sorteios), então
# a maior parte dos hackathons globais de lá NÃO aceita brasileiro.

BRAZIL_RE = re.compile(r"(?i)\b(brazil|brasil)\b")
# linhas genéricas do bloco (idade, estudante, time); o resto é público
# restrito ("SMU BIA members", "CETYS Students")
DEVPOST_GENERIC_LI = re.compile(
    r"(?i)^(above legal age|ages? \d|students only|college students only|"
    r"high school students only|professionals/post grads only|team required|"
    r"companies/professional organizations excluded|"
    r"all countries|specific|only specific|[\w .]+ only$)"
)
COUNTRY_PT = {
    "US": "EUA", "United States": "EUA", "USA": "EUA", "GB": "Reino Unido",
    "United Kingdom": "Reino Unido", "UK": "Reino Unido", "IN": "Índia",
    "India": "Índia", "CA": "Canadá", "Canada": "Canadá", "DE": "Alemanha",
    "Germany": "Alemanha", "FR": "França", "France": "França",
    "PT": "Portugal", "ES": "Espanha", "Spain": "Espanha", "MX": "México",
    "Mexico": "México", "AR": "Argentina", "CL": "Chile", "CO": "Colômbia",
    "Colombia": "Colômbia", "PE": "Peru", "UY": "Uruguai", "JP": "Japão",
    "Japan": "Japão", "SG": "Singapura", "Singapore": "Singapura",
    "AU": "Austrália", "Australia": "Austrália", "NL": "Holanda",
    "IT": "Itália", "Italy": "Itália", "CH": "Suíça", "Switzerland": "Suíça",
    "SE": "Suécia", "IE": "Irlanda", "KE": "Quênia", "NG": "Nigéria",
    "AE": "Emirados Árabes", "VN": "Vietnã", "Vietnam": "Vietnã",
    "TW": "Taiwan", "KR": "Coreia do Sul", "CN": "China", "HK": "Hong Kong",
    "PK": "Paquistão", "BD": "Bangladesh", "TR": "Turquia", "PL": "Polônia",
    "CZ": "Tchéquia", "BR": "Brasil", "Brazil": "Brasil",
}
LATAM = {"Brasil", "Argentina", "Chile", "Colômbia", "México", "Peru",
         "Uruguai", "Paraguai", "Bolívia", "Equador", "Venezuela",
         "Costa Rica", "Panamá", "Guatemala"}


def country_pt(c: str | None) -> str | None:
    if not c:
        return None
    c = c.strip()
    return COUNTRY_PT.get(c, c)


def _txt(fragment: str) -> str:
    import html as htmllib
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def devpost_eligibility(page: str) -> dict:
    """Lê o bloco "Who can participate" da página do hackathon no Devpost.

    Devolve {brazilOk, eligibilityNote, scope, country, restrictedTo,
    submissionDeadline}; campos sem evidência ficam None."""
    import html as htmllib
    out: dict = {"brazilOk": None, "eligibilityNote": None, "scope": None,
                 "country": None, "restrictedTo": None,
                 "submissionDeadline": None}
    dm = re.search(r'data-iso-date="([^"]+)"', page)
    if dm:
        out["submissionDeadline"] = dm.group(1)
    m = re.search(r'<ul id="eligibility-list".*?</ul>', page, re.S)
    if not m:
        return out
    items = re.findall(r"<li>(.*?)</li>", m.group(0), re.S)
    country_li = None
    for li in items:
        t = _txt(li)
        if re.search(r"(?i)countries/territories|\bonly$", t) and (
                "countries" in t or re.fullmatch(r"(?i)[\w .]+ only", t)):
            country_li = li
        elif not DEVPOST_GENERIC_LI.search(t):
            out["restrictedTo"] = t
    if country_li is None:
        return out
    text = _txt(country_li)
    tip = re.search(r'title="([^"]*)"', country_li)
    if tip:
        names = [htmllib.unescape(n).strip()
                 for n in tip.group(1).split(",") if n.strip()]
    else:
        modal = re.search(
            r'<ul id="eligibility-countries-modal-list".*?</ul>', page, re.S)
        names = ([_txt(x) for x in re.findall(r"<li>(.*?)</li>",
                                               modal.group(0), re.S)]
                 if modal else [])
    has_br = any(BRAZIL_RE.search(n) for n in names)
    lst = ", ".join(names)
    if re.match(r"(?i)only specific", text):
        out["brazilOk"] = "sim" if has_br else "nao"
        out["eligibilityNote"] = f"Only specific countries/territories included: {lst}"
        pts = [country_pt(n) for n in names]
        if pts and all(p in LATAM for p in pts) and len(pts) > 1:
            out["scope"] = "latam"
        else:
            out["scope"] = "pais"
            out["country"] = ", ".join(p for p in pts if p)
    elif re.search(r"(?i)excluding|excluded", text):
        if not names:
            return out  # lista não veio: sem evidência
        out["brazilOk"] = "nao" if has_br else "sim"
        out["eligibilityNote"] = f"All countries/territories, excluding: {lst}"
        out["scope"] = "global"
    elif re.search(r"(?i)^all countries", text):
        out["brazilOk"] = "sim"
        out["eligibilityNote"] = "All countries/territories"
        out["scope"] = "global"
    else:
        om = re.fullmatch(r"(?i)([\w .]+?) only", text)
        if om:
            c = country_pt(om.group(1))
            out["brazilOk"] = "sim" if c == "Brasil" else "nao"
            out["eligibilityNote"] = text
            out["scope"] = "pais"
            out["country"] = c
    return out


# Texto livre (descrição/regras de Luma, lablab, Devfolio): só frase explícita
# vale. "global hackathon" sozinho não prova nada.
OPEN_ALL_RE = re.compile(
    r"(?i)(open worldwide|open to (?:participants|developers|builders|hackers|teams|everyone"
    r"|anyone|all)[^.]{0,60}(?:worldwide|from (?:all|any) countr|around the"
    r" world|globally|of all nationalities)|aberto a (?:pessoas de )?todos os"
    r" pa[íi]ses|participants from (?:all|any) countr\w+ (?:are|can|may))")
ONLY_RE = re.compile(
    r"(?i)(?:open only to|only open to|exclusively (?:for|to)|restricted to)"
    r" (?:legal )?(?:residents|citizens|students)(?: of| in)? (?:the )?"
    r"([A-Z][A-Za-z ]{2,30})")
EXCLUDE_BR_RE = re.compile(
    r"(?i)(?:not open to|excluding|except|excluded)[^.]{0,200}\bbra[sz]il\b")


def _sentence(t: str, m: re.Match) -> str:
    """A frase inteira em volta do trecho que casou (até 300 caracteres)."""
    a = max(t.rfind(". ", 0, m.start()) + 2, m.start() - 200, 0)
    b = t.find(". ", m.end())
    b = len(t) if b < 0 else b + 1
    return t[a:min(b, a + 300)].strip()


def text_eligibility(text: str | None) -> dict:
    """Frase de regra num texto livre → {brazilOk, eligibilityNote}."""
    out = {"brazilOk": None, "eligibilityNote": None}
    t = " ".join((text or "").split())
    if not t:
        return out
    m = EXCLUDE_BR_RE.search(t)
    if m:
        return {"brazilOk": "nao", "eligibilityNote": _sentence(t, m)}
    m = ONLY_RE.search(t)
    if m:
        c = country_pt(m.group(1).strip())
        return {"brazilOk": "sim" if c == "Brasil" else "nao",
                "eligibilityNote": _sentence(t, m)}
    m = OPEN_ALL_RE.search(t)
    if m:
        return {"brazilOk": "sim", "eligibilityNote": _sentence(t, m)}
    return out


# ---------- alcance, marca e prêmio ----------

BRANDS = [
    ("NASA", r"\bnasa\b|space apps"),
    ("Meta", r"\bmeta\b|\bllama\b"),
    ("NVIDIA", r"nvidia"),
    ("Google", r"\bgoogle\b|\bgemini\b|\bgemma\b|\bgdg\b"),
    ("AWS", r"\baws\b|amazon"),
    ("Microsoft", r"microsoft|\bazure\b"),
    ("OpenAI", r"openai|\bcodex\b|devday"),
    ("Anthropic", r"anthropic|\bclaude\b"),
    ("Solana", r"\bsolana\b|colosseum"),
    ("Ethereum", r"ethglobal|ethereum|\beth[a-z]*\d{0,4}\b"),
    ("AMD", r"\bamd\b"),
    ("IBM", r"\bibm\b"),
    ("Stripe", r"\bstripe\b"),
    ("PayPal", r"paypal"),
    ("GitLab", r"gitlab"),
    ("Itaú", r"ita[úu]"),
    ("MLH", r"^mlh$"),
]


def brand_of(row: dict) -> str | None:
    hay = f"{row.get('name') or ''} | {row.get('organizer') or ''}"
    for brand, rx in BRANDS:
        if re.search(rf"(?i){rx}", hay):
            return brand
    return None


def fill_reach(row: dict) -> dict:
    """Completa alcance, país, brasileiro-pode, prêmio em US$ e marca.

    Regra do brasileiro-pode: a elegibilidade da fonte manda; sem ela, só
    evento no Brasil (presencial aqui ou online de fonte brasileira) vira
    'sim'. O resto fica None — não informado."""
    r = row
    for k in ("brazilOk", "eligibilityNote", "scope", "country"):
        r.setdefault(k, None)
    region = r.get("region") or region_of(r)
    r["region"] = region
    if region == "br":
        r.setdefault("country", "Brasil")
        r["country"] = r.get("country") or "Brasil"
        r["scope"] = r.get("scope") or ("cidade" if r.get("location") else "brasil")
        if not r.get("brazilOk"):
            r["brazilOk"] = "sim"
            r["eligibilityNote"] = r.get("eligibilityNote") or "Acontece no Brasil."
    elif region == "online-br":
        r["scope"] = r.get("scope") or "brasil"
        # fonte brasileira ou prêmio em real é evidência; português sozinho
        # não (Hack4Guimarães, no TAIKAI, é de Portugal)
        srcs = set((r.get("source") or "").split("+"))
        if not r.get("brazilOk") and (srcs & BR_SOURCES or (
                r.get("prize") or "").startswith("R$")):
            r["brazilOk"] = "sim"
            r["eligibilityNote"] = (r.get("eligibilityNote")
                                    or "Evento online brasileiro.")
    elif region == "online-mundo":
        r["scope"] = r.get("scope") or "global"
    else:  # exterior
        r["scope"] = r.get("scope") or "cidade"
    if r.get("country"):
        r["country"] = country_pt(r["country"])
    usd = prize_usd(r.get("prize"))
    r["prizeUsd"] = int(round(usd)) if usd else None
    r["brand"] = r.get("brand") or brand_of(r)
    return r


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
   region, excludedReason, first_seen, last_seen, scope, country, brazilOk,
   eligibilityNote, eligibilityUrl, eligibilityCheckedAt, prizeUsd,
   submissionDeadline, brand)
VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location,
   @registrationUrl, @registrationDeadline, @tags, @active, @source,
   @prize, @region, NULL, @now, @now, @scope, @country, @brazilOk,
   @eligibilityNote, @eligibilityUrl, @eligibilityCheckedAt, @prizeUsd,
   @submissionDeadline, @brand)
ON CONFLICT(id) DO UPDATE SET
  -- regra lida da página (eligibilityCheckedAt) vale até a próxima leitura;
  -- o resto (evento no Brasil, sem regra) é recalculado a cada rodada
  name=excluded.name, organizer=excluded.organizer,
  startsAt=excluded.startsAt, endsAt=excluded.endsAt,
  format=excluded.format, location=excluded.location,
  registrationUrl=excluded.registrationUrl,
  registrationDeadline=excluded.registrationDeadline,
  tags=excluded.tags, active=excluded.active, source=excluded.source,
  prize=excluded.prize, region=excluded.region, excludedReason=NULL,
  last_seen=excluded.last_seen, scope=excluded.scope,
  country=excluded.country,
  brazilOk=CASE WHEN excluded.eligibilityCheckedAt IS NULL
                 AND hackathons.eligibilityCheckedAt IS NOT NULL
                THEN hackathons.brazilOk ELSE excluded.brazilOk END,
  eligibilityNote=CASE WHEN excluded.eligibilityCheckedAt IS NULL
                 AND hackathons.eligibilityCheckedAt IS NOT NULL
                THEN hackathons.eligibilityNote ELSE excluded.eligibilityNote END,
  eligibilityUrl=COALESCE(excluded.eligibilityUrl, hackathons.eligibilityUrl),
  eligibilityCheckedAt=COALESCE(excluded.eligibilityCheckedAt,
                                hackathons.eligibilityCheckedAt),
  prizeUsd=excluded.prizeUsd,
  submissionDeadline=COALESCE(excluded.submissionDeadline,
                              hackathons.submissionDeadline),
  brand=excluded.brand"""

ROW_DEFAULTS = ("prize", "scope", "country", "brazilOk", "eligibilityNote",
                "eligibilityUrl", "eligibilityCheckedAt", "prizeUsd",
                "submissionDeadline", "brand")


def upsert(conn, rows: list[dict]) -> int:
    """Insere/atualiza por id estável; active reflete expiração; nunca apaga."""
    n = 0
    for r in rows:
        if not r.get("startsAt"):
            continue
        r = fill_reach(dict(r))
        r["tags"] = json.dumps(r.get("tags") or [])
        r["active"] = 0 if is_expired(r) else 1
        for k in ROW_DEFAULTS:
            r.setdefault(k, None)  # fonte sem o dado grava NULL
        r["now"] = NOW.isoformat()
        conn.execute(UPSERT_SQL, r)
        n += 1
    return n


def load_elig_cache(conn) -> dict[str, dict]:
    """Elegibilidade lida há menos de DEVPOST_ELIG_TTL_DAYS: não relê."""
    from datetime import timedelta
    since = (NOW - timedelta(days=DEVPOST_ELIG_TTL_DAYS)).isoformat()
    cache = {}
    for (rid, ok, note, url, checked, scope, country, sub) in conn.execute(
            "SELECT id, brazilOk, eligibilityNote, eligibilityUrl,"
            " eligibilityCheckedAt, scope, country, submissionDeadline"
            " FROM hackathons WHERE eligibilityCheckedAt IS NOT NULL"
            " AND to_ts(eligibilityCheckedAt) >= to_ts(?)", (since,)):
        if sub and not re.search(r"T.*[+-]\d{2}:?\d{2}$|Z$", sub):
            continue  # prazo sem fuso (linha antiga): relê a página
        cache[rid] = {"brazilOk": ok, "eligibilityNote": note,
                      "eligibilityUrl": url, "eligibilityCheckedAt": checked,
                      "scope": scope, "country": country,
                      "submissionDeadline": sub}
    return cache


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
    o banco guarda: nome, organizador, prêmio. Também preenche região,
    alcance, prêmio em US$ e marca de quem ainda não tem (curadoria e
    indicação inclusive). Retorna (desativadas, linhas completadas)."""
    off = filled = 0
    rows = conn.execute(
        "SELECT id, name, organizer, format, location, prize, source, region,"
        " scope, brazilOk, eligibilityNote, last_seen"
        f" FROM hackathons WHERE active=1 AND NOT {EDITION_WHERE}"
    ).fetchall()
    for (rid, name, org, fmt, loc, prize, src, region, scope, ok, note,
         seen) in rows:
        row = {"id": rid, "name": name, "organizer": org, "format": fmt,
               "location": loc, "prize": prize, "source": src,
               "region": region, "brazilOk": ok, "eligibilityNote": note}
        first = (src or "").split("+")[0]
        fresh = seen and str(seen) >= NOW.isoformat()[:19]
        reason = (classify(row) if first in STRICT_SOURCES | NATIVE_SOURCES
                  and not fresh else None)
        if reason:
            conn.execute(
                "UPDATE hackathons SET active=0, excludedReason=? WHERE id=?",
                (reason, rid),
            )
            off += 1
        elif not region or not scope:
            r = fill_reach(row)
            conn.execute(
                "UPDATE hackathons SET region=?, scope=?, country=?,"
                " brazilOk=?, eligibilityNote=?, prizeUsd=?, brand=?"
                " WHERE id=?",
                (r["region"], r["scope"], r.get("country"), r.get("brazilOk"),
                 r.get("eligibilityNote"), r.get("prizeUsd"), r.get("brand"),
                 rid))
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


UA = ("Mozilla/5.0 (compatible; HackaHubRadar/1.0; "
      "+https://hackahub.jazzautomations.com.br)")


def http_get(url: str, **kw):
    """GET educado: UA identificado, timeout. Quem chama dorme entre chamadas."""
    headers = {"User-Agent": UA, **kw.pop("headers", {})}
    return requests.get(url, headers=headers, timeout=kw.pop("timeout", 25),
                        **kw)


def parse_devpost_api(d: dict) -> list[dict]:
    """Uma página da API pública do Devpost → linhas do radar (sem a
    elegibilidade, que vem da página de cada hackathon)."""
    out = []
    for h in d.get("hackathons", []):
        if h.get("invite_only") or h.get("open_state") == "ended":
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
            # "Dec 1, 2026 - Jan 5, 2027": o 1º pedaço já traz o ano
            if start and end and start > end:
                start = start.replace(year=end.year - 1)
            if end:  # a API só manda o dia: vale até o fim dele
                end = end.replace(hour=23, minute=59)
        dl = h.get("displayed_location") or {}
        loc = dl.get("location") or "Online"
        online = loc.lower().startswith("online") or dl.get("icon") == "globe"
        out.append({
            "id": f"devpost-{h['id']}",
            "name": h["title"],
            "organizer": h.get("organization_name") or "Devpost",
            "startsAt": iso(start),
            "endsAt": iso(end),
            "format": "online" if online else "presencial",
            "location": None if online else loc,
            "registrationUrl": h["url"],
            "registrationDeadline": iso(end),
            "submissionDeadline": iso(end),
            "tags": devpost_tags(t.get("name") for t in h.get("themes", [])),
            "prize": prize_display(h.get("prize_amount")),
            "registrations": h.get("registrations_count"),
            "featured": bool(h.get("featured")),
            "eligibilityUrl": h["url"].rstrip("/") + "/rules",
            "source": "devpost",
        })
    return out


def devpost_enrich(rows: list[dict], fetch=None,
                   max_fetch: int = DEVPOST_ELIG_MAX_FETCH) -> int:
    """Lê "Who can participate" de cada hackathon (página pública, robots
    libera). Cache do banco evita reler antes de DEVPOST_ELIG_TTL_DAYS.
    Maior prêmio primeiro, pra rodada com teto pegar o que importa."""
    fetch = fetch or (lambda u: http_get(u))
    n = 0
    order = sorted(rows, key=lambda r: -(prize_usd(r.get("prize")) or 0))
    for r in order:
        cached = ELIG_CACHE.get(r["id"])
        if cached:
            for k, v in cached.items():
                if v is not None and (not r.get(k) or k == "submissionDeadline"):
                    r[k] = v
            if cached.get("submissionDeadline"):
                r["registrationDeadline"] = cached["submissionDeadline"]
            continue
        if n >= max_fetch or classify(r):
            continue  # teto da rodada, ou já cai no filtro de lixo
        try:
            resp = fetch(r["registrationUrl"])
        except Exception:
            continue
        n += 1
        if getattr(resp, "ok", False):
            el = devpost_eligibility(resp.text)
            for k, v in el.items():
                if v is not None:
                    r[k] = v
            # no Devpost a inscrição vai até o prazo de entrega, com hora
            if el.get("submissionDeadline"):
                r["registrationDeadline"] = el["submissionDeadline"]
            r["eligibilityCheckedAt"] = NOW.isoformat()
        time.sleep(DEVPOST_ELIG_SLEEP)
    return n


def src_devpost() -> list[dict]:
    """API pública: abertos e em breve, todas as páginas (total_count manda).
    Em breve = inscrição aberta antes da janela de entrega."""
    out, seen = [], set()
    for status in ("open", "upcoming"):
        for page in range(1, DEVPOST_MAX_PAGES + 1):
            d = http_get("https://devpost.com/api/hackathons",
                         params={"status[]": status, "page": page,
                                 "per_page": DEVPOST_PER_PAGE}).json()
            for r in parse_devpost_api(d):
                if r["id"] not in seen:
                    seen.add(r["id"])
                    out.append(r)
            total = (d.get("meta") or {}).get("total_count") or 0
            per = (d.get("meta") or {}).get("per_page") or DEVPOST_PER_PAGE
            time.sleep(DEVPOST_PAGE_SLEEP)
            if not d.get("hackathons") or page * per >= total:
                break
    fetched = devpost_enrich(out)
    print(f"      devpost    {len(out)} na API, {fetched} páginas de regra lidas")
    return out


TAIKAI_REG_RE = re.compile(
    r"(?i)registration (?:deadline|closes)|last call|inscri\w+ (?:encerr|fech)")
TAIKAI_SUB_RE = re.compile(r"(?i)submission deadline|submiss\w+ (?:final|de projeto)")


def parse_taikai(d: dict) -> list[dict]:
    """Desafios ativos do TAIKAI. Datas vêm das etapas (steps): início = a
    primeira, fim = a última; prazo de inscrição/entrega pelo nome da etapa.
    Desafio fechado (isClosed) fica de fora."""
    out = []
    for c in d["data"]["challenges"]:
        if c.get("isClosed"):
            continue
        steps = [s for s in c.get("steps") or [] if s.get("startDate")]
        dates = sorted(s["startDate"] for s in steps)
        if not dates:
            continue
        reg = next((s["startDate"] for s in steps
                    if TAIKAI_REG_RE.search(s.get("name") or "")), None)
        sub = next((s["startDate"] for s in steps
                    if TAIKAI_SUB_RE.search(s.get("name") or "")), None)
        org = c.get("organization") or {}
        out.append({
            "id": f"taikai-{c['slug']}",
            "name": c["name"],
            "organizer": org.get("name") or "TAIKAI",
            "startsAt": dates[0],
            "endsAt": dates[-1],
            "format": "online",
            "location": None,
            "registrationUrl": f"https://taikai.network/{org.get('slug','')}/hackathons/{c['slug']}",
            "registrationDeadline": reg,
            "submissionDeadline": sub,
            "tags": [],
            "prize": taikai_prize(c.get("prize"),
                                  (c.get("prizeCurrency") or {}).get("name")),
            "source": "taikai",
        })
    return out


def src_taikai() -> list[dict]:
    q = """query { challenges(where: { publishInfo: { state: { equals: ACTIVE } } },
      perPage: 50) { name slug isClosed prize prizeCurrency { name }
      organization { name slug } steps { name startDate } } }"""
    d = requests.post(
        "https://api.taikai.network/api/graphql",
        json={"query": q}, headers={"User-Agent": UA}, timeout=20,
    ).json()
    return parse_taikai(d)


def next_flight(html_text: str) -> str:
    """Junta o payload RSC do Next (self.__next_f.push([1,"…"]))."""
    return "".join(
        json.loads('"' + m.group(1) + '"')
        for m in re.finditer(
            r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html_text))


def flight_array(flight: str, key: str) -> list:
    i = flight.find(f'"{key}":[')
    if i < 0:
        return []
    arr, _ = json.JSONDecoder().raw_decode(flight[i + len(key) + 3:])
    return arr


def parse_ethglobal(html_text: str, now: datetime | None = None) -> list[dict]:
    """ETHGlobal /events: a lista vem no payload do Next ("events":[…]) com
    tipo, formato (physical/virtual), datas, prazo de inscrição e cidade."""
    now = now or NOW
    out = []
    for e in flight_array(next_flight(html_text), "events"):
        if e.get("type") != "hackathon" or e.get("status") == "cancelled":
            continue
        end = parse_date(e.get("endTime") or e.get("startTime") or "")
        if not end or _aware(end) < now:
            continue
        city = e.get("city") or {}
        country = (city.get("country") or {}).get("name")
        virtual = e.get("medium") == "virtual"
        out.append({
            "id": f"ethglobal-{e['slug']}",
            "name": e["name"],
            "organizer": "ETHGlobal",
            "startsAt": e.get("startTime"),
            "endsAt": e.get("endTime"),
            "format": "online" if virtual else "presencial",
            "location": None if virtual else ", ".join(
                p for p in (city.get("name"), country_pt(country)) if p),
            "country": None if virtual else country,
            "registrationUrl": f"https://ethglobal.com/events/{e['slug']}",
            "registrationDeadline": e.get("signupDeadline"),
            "tags": ["web3", "ethereum"],
            "source": "ethglobal",
        })
    return out


def src_ethglobal() -> list[dict]:
    r = http_get("https://ethglobal.com/events")
    return parse_ethglobal(r.text) if r.ok else []


def parse_mlh(html_text: str) -> list[dict]:
    """Temporada da MLH (www.mlh.com): JSON da página (data-page) com
    upcomingEvents — nome, datas, formato e endereço."""
    m = re.search(r'<script data-page="app" type="application/json">(.*?)'
                  r'</script>', html_text, re.S)
    if not m:
        return []
    out = []
    for e in json.loads(m.group(1)).get("props", {}).get("upcomingEvents", []):
        ft = e.get("formatType") or ""
        fmt = ("online" if ft in ("digital", "online", "virtual")
               else "hibrido" if "hybrid" in ft else "presencial")
        addr = e.get("venueAddress") or {}
        country = addr.get("country")
        loc = ", ".join(p for p in (addr.get("city"), addr.get("state"),
                                    country_pt(country)) if p) or e.get("location")
        out.append({
            "id": f"mlh-{e['slug']}",
            "name": e["name"],
            "organizer": "MLH",
            "startsAt": e.get("startsAt"),
            "endsAt": e.get("endsAt"),
            "format": fmt,
            "location": None if fmt == "online" else loc,
            "country": None if fmt == "online" else country,
            "registrationUrl": e.get("websiteUrl")
            or f"https://www.mlh.com/events/{e['slug']}",
            "registrationDeadline": None,
            "tags": ["estudante"],
            "source": "mlh",
        })
    return out


def src_mlh() -> list[dict]:
    out, seen = [], set()
    for season in ("2027", "2026"):
        r = http_get(f"https://www.mlh.com/seasons/{season}/events")
        if r.ok:
            for row in parse_mlh(r.text):
                if row["id"] not in seen:
                    seen.add(row["id"])
                    out.append(row)
        time.sleep(SLEEP)
    return out


# Luma: a API pública do discover (a mesma do luma.com/discover) responde
# fora dos EUA. Busca por termo no mundo, por termo em SP e RJ (os dois
# "places" brasileiros do Luma) e os calendários públicos de comunidades que
# fazem hackathon no Brasil. Só entra nome de hackathon (STRICT_SOURCES).
LUMA_API = "https://api.lu.ma"
LUMA_TERMS = ("hackathon", "hackaton", "buildathon", "game jam", "datathon")
LUMA_PLACES = {
    "discplace-AQZnCu9wl4LmOIp": "São Paulo",
    "discplace-EWglyhh4fsHKo2F": "Rio de Janeiro",
}
LUMA_CALENDARS = {
    "cal-2WIWx400iGONnaP": "Shiva Hacks",
    "cal-s9CExmUfS7kMu50": "Vibe Space Academy",
    "cal-6VjUUsGp1WXCdgW": "Canastra Ventures",
    "cal-TOpA5LAFfuDeFpu": "Claude Community Events",
    "cal-E74MDlDKBaeAwXK": "The AI Collective",
    "cal-cGhQOoteH3hOCwU": "Mulheres de Produto",
    "cal-RZbHpa33PT0peAT": "Stranger Builds",
}
LUMA_MAX_PAGES = 3


def parse_luma_entries(entries: list, calendar_name: str | None = None
                       ) -> list[dict]:
    out = []
    for x in entries:
        ev = x.get("event") or {}
        if not ev.get("url") or not ev.get("start_at"):
            continue
        geo = ev.get("geo_address_info") or {}
        offline = ev.get("location_type") == "offline"
        cc = geo.get("country_code")
        loc = None
        if offline:
            if cc == "BR":
                loc = (geo.get("localized", {}).get("pt-BR", {}).get("city_state")
                       or geo.get("city_state"))
            else:
                loc = ", ".join(p for p in (
                    geo.get("city"),
                    country_pt(geo.get("country")) or country_pt(cc))
                                if p) or None
        cal = x.get("calendar") or {}
        org = calendar_name or cal.get("name")
        if not org or org == "Personal":
            hosts = x.get("hosts") or []
            org = hosts[0].get("name") if hosts else None
        out.append({
            "id": f"luma-{ev['url'].lower()}",
            "name": " ".join(ev["name"].split()),
            "organizer": org or "via Luma",
            "startsAt": ev["start_at"],
            "endsAt": ev.get("end_at"),
            "format": "presencial" if offline else "online",
            "location": loc,
            "country": cc if offline else None,
            "registrationUrl": f"https://luma.com/{ev['url']}",
            "registrationDeadline": None,
            "tags": [],
            "source": "luma",
        })
    return out


def _luma_pages(path: str, params: dict) -> list:
    entries, cursor = [], None
    for _ in range(LUMA_MAX_PAGES):
        p = dict(params, pagination_limit=50)
        if cursor:
            p["pagination_cursor"] = cursor
        r = http_get(f"{LUMA_API}{path}", params=p)
        time.sleep(SLEEP)
        if not r.ok:
            break
        d = r.json()
        entries += d.get("entries", [])
        cursor = d.get("next_cursor")
        if not d.get("has_more") or not cursor:
            break
    return entries


def src_luma() -> list[dict]:
    out, seen = [], set()

    def add(rows):
        for row in rows:
            if row["id"] not in seen:
                seen.add(row["id"])
                out.append(row)

    for term in LUMA_TERMS:
        add(parse_luma_entries(_luma_pages(
            "/discover/get-paginated-events", {"query": term})))
    for place in LUMA_PLACES:
        add(parse_luma_entries(_luma_pages(
            "/discover/get-paginated-events",
            {"query": "hackathon", "discover_place_api_id": place})))
    for cal, name in LUMA_CALENDARS.items():
        add(parse_luma_entries(_luma_pages(
            "/calendar/get-items",
            {"calendar_api_id": cal, "period": "future"}), name))
    return out


def parse_devfolio(d: dict) -> list[dict]:
    """Busca pública do Devfolio (POST /api/search/hackathons)."""
    out = []
    for h in (d.get("hits") or {}).get("hits", []):
        s = h.get("_source") or {}
        if s.get("private") or not s.get("slug"):
            continue
        st = s.get("hackathon_setting") or {}
        online = bool(s.get("is_online"))
        country = s.get("country")
        out.append({
            "id": f"devfolio-{s['slug']}",
            "name": " ".join((s.get("name") or "").split()),
            "organizer": s.get("hosted_by") or "via Devfolio",
            "startsAt": s.get("starts_at"),
            "endsAt": s.get("ends_at"),
            "format": "online" if online else "presencial",
            "location": None if online else ", ".join(
                p for p in (s.get("city"), country_pt(country)) if p) or None,
            "country": None if online else country,
            "registrationUrl": f"https://{s['slug']}.devfolio.co/",
            "registrationDeadline": st.get("reg_ends_at"),
            "tags": [],
            "source": "devfolio",
            **{k: v for k, v in text_eligibility(s.get("desc")).items() if v},
        })
    return out


def src_devfolio() -> list[dict]:
    out = []
    for typ in ("application_open", "upcoming"):
        r = requests.post("https://api.devfolio.co/api/search/hackathons",
                          json={"type": typ, "from": 0, "size": 50},
                          headers={"User-Agent": UA}, timeout=25)
        if r.ok:
            out += parse_devfolio(r.json())
        time.sleep(SLEEP)
    return list({r["id"]: r for r in out}.values())


def parse_lablab(html_text: str, now: datetime | None = None) -> list[dict]:
    """lablab.ai/ai-hackathons: "sortedEvents" no payload do Next. Só
    HACKATHON com inscrição aberta e fim no futuro."""
    now = now or NOW
    out = []
    for e in flight_array(next_flight(html_text), "sortedEvents"):
        if e.get("type") != "HACKATHON" or not e.get("signupActive"):
            continue
        end = parse_date(e.get("endAt") or "")
        if not end or _aware(end) < now or e.get("toBeAnnounced"):
            continue
        et = (e.get("eventType") or "").upper()
        el = text_eligibility(e.get("description"))
        out.append({
            "id": f"lablab-{e['slug']}",
            "name": e["name"],
            "organizer": "lablab.ai",
            "startsAt": e.get("startAt"),
            "endsAt": e.get("endAt"),
            "format": "hibrido" if et == "HYBRID" else
                      "presencial" if et in ("ONSITE", "IN_PERSON") else "online",
            "location": None,
            "registrationUrl": f"https://lablab.ai/ai-hackathons/{e['slug']}",
            "registrationDeadline": None,
            "tags": ["ia"],
            "source": "lablab",
            **{k: v for k, v in el.items() if v},
        })
    return out


LABLAB_PRIZE_RE = re.compile(r"(?i)total prize pool:?\s*(\$\s?[\d,.]+\s?[kK]?)")


def lablab_page_details(page_text: str) -> dict:
    """Página do evento no lablab: prêmio total e frase de elegibilidade."""
    txt = _txt(re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ",
                      page_text))
    out = {k: v for k, v in text_eligibility(txt).items() if v}
    m = LABLAB_PRIZE_RE.search(txt)
    if m:
        out["prize"] = m.group(1).replace(" ", "")
    return out


def src_lablab() -> list[dict]:
    r = http_get("https://lablab.ai/ai-hackathons")
    out = parse_lablab(r.text) if r.ok else []
    for row in out:  # poucos (2–5): abre a página de cada um
        time.sleep(SLEEP)
        p = http_get(row["registrationUrl"])
        if p.ok:
            row.update(lablab_page_details(p.text))
    return out


def parse_hackclub(items: list) -> list[dict]:
    """hackathons.hackclub.com/api/events/upcoming/ — hackathons de
    estudante do ensino médio (a maioria nos EUA/Canadá)."""
    out = []
    for e in items:
        online = bool(e.get("virtual"))
        country = e.get("countryCode") or e.get("country")
        out.append({
            "id": f"hackclub-{e['id'].lower()}",
            "name": e["name"],
            "organizer": "via Hack Club",
            "startsAt": e.get("start"),
            "endsAt": e.get("end"),
            "format": "online" if online else
                      "hibrido" if e.get("hybrid") else "presencial",
            "location": None if online else ", ".join(
                p for p in (e.get("city"), e.get("state"),
                            country_pt(e.get("country"))) if p) or None,
            "country": None if online else country,
            "registrationUrl": e.get("website"),
            "registrationDeadline": None,
            "tags": ["estudante"],
            "source": "hackclub",
        })
    return [r for r in out if r["registrationUrl"]]


# Páginas oficiais de marca grande, uma por evento, com "Key Dates" em texto.
# Entram aqui só quando a página é pública e estável. Hoje: Meta.
BRAND_PAGES = {
    "meta-global-ai-hackathon": ("https://dev.meta.ai/events/global-hackathon",
                                 "Meta"),
}
KEY_DATE = r"([A-Z][a-z]{2}) (\d{1,2})"


def parse_brand_page(page: str, rid: str, url: str, organizer: str
                     ) -> dict | None:
    """Página oficial → linha do radar: nome do <h1>/título, prêmio
    ("$1M in prizes"), datas do bloco Key Dates e a frase de elegibilidade."""
    txt = _txt(re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", page))
    title = re.search(r"(?s)<title>(.*?)</title>", page)
    name = _txt(title.group(1)) if title else ""
    name = re.sub(r"^Win [^:]+:\s*", "", name).strip()
    year = re.search(r"\b(20\d\d)\b", txt)
    year = year.group(1) if year else str(NOW.year)

    from zoneinfo import ZoneInfo
    tzs = {"ET": "America/New_York", "PT": "America/Los_Angeles", "UTC": "UTC"}

    def when(rx, default_time="23:59"):
        """Data do Key Dates com hora e fuso da página (ET/PT); sem hora,
        o fim do dia (prazo) ou o padrão passado (início)."""
        m = re.search(KEY_DATE + r"(?:,? ([\d:]+ ?[AP]M) (ET|PT|UTC))?" + rx, txt)
        if not m:
            return None
        dt = parse_date(f"{m.group(1)} {m.group(2)} {year} {m.group(3) or default_time}")
        if not dt:
            return None
        return dt.replace(tzinfo=ZoneInfo(tzs.get(m.group(4) or "ET"))).isoformat()

    deadline = when(r" Applications? Deadline")
    start = when(r" Hackathon begins", "09:00")
    sub = when(r" Project submissions due") or when(
        r" Project submissions due by ([\d:]+ ?[AP]M)")
    m = re.search(KEY_DATE + r" Project submissions due by ([\d:]+ ?[AP]M) (ET|PT)", txt)
    if m:
        dt = parse_date(f"{m.group(1)} {m.group(2)} {year} {m.group(3)}")
        sub = dt.replace(tzinfo=ZoneInfo(tzs[m.group(4)])).isoformat()
    end = when(r" Closing ceremony") or sub
    if not name or not start:
        return None
    pm = re.search(r"\$([\d,]{5,})(?: cash)? (?:cash )?(?:prize pool|in total prizes)", txt)
    online = re.search(r"(?i)\bvirtual\b|\bonline\b", txt)
    return {
        "id": rid,
        "name": name,
        "organizer": organizer,
        "startsAt": start,
        "endsAt": end,
        "format": "online" if online else "presencial",
        "location": None,
        "registrationUrl": url,
        "registrationDeadline": deadline,
        "submissionDeadline": sub,
        "tags": ["ia"],
        "prize": f"${pm.group(1)}" if pm else None,
        "eligibilityUrl": url,
        "source": "marcas",
        **{k: v for k, v in text_eligibility(txt).items() if v},
    }


def src_brands() -> list[dict]:
    out = []
    for rid, (url, org) in BRAND_PAGES.items():
        r = http_get(url)
        if r.ok:
            row = parse_brand_page(r.text, rid, url, org)
            if row:
                out.append(row)
        time.sleep(SLEEP)
    return out


def src_hackclub() -> list[dict]:
    r = http_get("https://hackathons.hackclub.com/api/events/upcoming/")
    return parse_hackclub(r.json()) if r.ok else []


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


# ---------- fontes brasileiras ----------

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


SYMPLA_TERMS = ("hackathon", "hackaton", "game jam", "datathon", "ideathon",
                "space apps")
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
    "dorahacks": "página e API atrás de captcha AWS WAF",
    "hackerearth": "403 pra robô em todas as páginas",
    "openai-events": "events.openai.com responde 403 (desafio Cloudflare)",
    "kaggle": "lista de competições só por API com login",
    "cerebralvalley": "API pública só devolve evento antigo (2024/25)",
    "gupy": "sem busca pública de vaga; hackathon de banco fica na curadoria",
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
    ("meetup", src_meetup),
    ("luma", src_luma),
    ("devpost", src_devpost),
    ("taikai", src_taikai),
    ("ethglobal", src_ethglobal),
    ("mlh", src_mlh),
    ("devfolio", src_devfolio),
    ("lablab", src_lablab),
    ("hackclub", src_hackclub),
    ("marcas", src_brands),
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
                kept.append(fill_reach(r))
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
            by_ok: dict[str, int] = {}
            for r in kept:
                by_region[r["region"]] = by_region.get(r["region"], 0) + 1
                ok = r.get("brazilOk") or "?"
                by_ok[ok] = by_ok.get(ok, 0) + 1
            regs = ", ".join(f"{k} {v}" for k, v in sorted(by_region.items()))
            oks = ", ".join(f"{k} {v}" for k, v in sorted(by_ok.items()))
            print(f"[ok] {name:10s} {len(kept):3d} eventos"
                  + (f" ({regs})" if regs else "")
                  + (f" · brasileiro pode: {oks}" if oks else ""))
    return collected, rejected


def main() -> None:
    if not DATABASE_URL:
        sys.exit("DATABASE_URL não definida (postgres://…)")
    import psycopg
    conn = PgConn(psycopg.connect(DATABASE_URL))
    ensure_schema(conn)
    ELIG_CACHE.update(load_elig_cache(conn))

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
    for ok, n in conn.execute(
        "SELECT COALESCE(brazilOk, 'nao informado'), COUNT(*) FROM hackathons"
        f" WHERE active=1 AND NOT {EDITION_WHERE}"
        "   AND to_ts(COALESCE(endsAt, registrationDeadline, startsAt)) >= now()"
        " GROUP BY 1 ORDER BY 1"
    ):
        print(f"  aberto · brasileiro pode: {ok:14s} {n}")


if __name__ == "__main__":
    main()
