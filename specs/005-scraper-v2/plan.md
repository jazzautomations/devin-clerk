# Implementation Plan: Scraper v2 — Radar Externo Confiável

**Branch**: `005-scraper-v2` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Refatora `scripts/scrape_radar.py` em três estágios: **coletar** (uma função pura por fonte), **qualificar** (`is_hackathon` nas fontes ruidosas + `dedupe` por chave nome+data) e **persistir** (upsert com `active` por expiração, `first_seen`/`last_seen`, sweep de expirados e reconciliação de dupes antigas). Devpost pagina via `meta.total_count`; ETHGlobal ganha parser dos cards tipados do Jina com fallback e log "degraded". Testes: asserts puros em `scripts/test_scrape_radar.py` (sem pytest na venv), script `test:scrape` no package.json.

## Technical Context

- **Language**: Python 3.12 (`.venv-scraper`, via `uv run`)
- **Storage**: SQLite `data/hackahub.db`, tabela `hackathons` (schema dono: `lib/db.ts` — scraper só faz `ALTER TABLE ADD COLUMN` idempotente, nunca migração destrutiva)
- **Testing**: asserts puros (sem pytest instalado) + rodada real no banco de dev
- **Escopo**: só `scripts/` + `specs/` + `package.json` (script `test:scrape`). Não toca `app/`, `components/`, `lib/*.ts`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: radar continua gratuito; eventos da comunidade intocados ✅
- III. Auth & data integrity: upsert nunca apaga linha; comunidade (`source IS NULL`) nunca desativada ✅
- IV. One-session scope: refactor + testes + rodada real em uma sessão ✅
- V. No slop UI: sem UI nesta feature ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| dedupe_key | `norm(nome) + "|" + startsAt[:10]`; `norm` = lowercase sem `[^a-z0-9]` | Estável entre fontes/rodagens; "Hacka Santa" = "hackasanta" = "HACKASANTA 2026" não — ano no nome mantido propositalmente (edições distintas têm datas distintas, mas mesmo nome+mesma data quase sempre é o mesmo evento) |
| Vencedor do dedupe | score = nº campos preenchidos + nº tags (+0.5 se `curadoria`) | "Preferir mais metadados"; curadoria verificada à mão desempata |
| `source` em merge | `"+".join(sorted(fontes))` ex. `curadoria+ethglobal` | Preserva proveniência; counts do relatório usam a coleta, não o merge |
| Classificador | nega só quando denylist bate **sem** hack-term; neutro passa | "Meetup de dados" e "DevOps Summit" caem; "NASA Space Apps" (curadoria legítima sem "hack" no nome) sobrevive |
| Expiração | `active = 0` se `parse(endsAt or startsAt) < now` no upsert + sweep `UPDATE ... WHERE source IS NOT NULL AND datetime(coalesce(endsAt,startsAt)) < datetime('now')` | Cobre linha nova e linha velha que a fonte parou de retornar |
| Devpost paginação | `per_page=24`, `page` até `page*per_page >= total_count`, máx. 5 páginas, `sleep(1.2)` | API confirma `meta.total_count` (52 hoje); `has_next` que o código antigo checava **não existe** — por isso só saía 1 página |
| ETHGlobal parser | card = `### BODY TIPO](url)`; TIPO ∈ Hackathon/Meetup/Conference/Co-working/Summit; só `Hackathon` entra; data = primeiro range dentro de BODY | Regex antiga cruzava fronteira de card (`[^\]]*` comia o próximo card) — nome de um, data de outro; parser por tipo é robusto e já classifica |
| ETHGlobal fallback | endpoints `/api/events`, `/api/v2/events`, `api.ethglobal.com/events` com timeout curto (hoje 404/403 — código fica pra quando existirem); 0 final → log "degraded" | Não inventa dado; curadoria cobre |
| Comunidade vs raspado | se `dedupe_key` do raspado já existe em linha `source IS NULL` → skip + log | Comunidade é autoridade editorial; evita dupe visível no radar |
| Dupes antigas no banco | após upsert: linhas externas com mesma chave do vencedor mas id diferente → `active=0` | Limpa dupes legadas sem DELETE |

## Phase 1 — Design

### Fluxo do `main()`

```text
connect → ensure_schema (CREATE IF NOT EXISTS + PRAGMA/ALTER first_seen,last_seen,source)
  → para cada fonte: coleta → [filtro is_hackathon] → log [ok]/[fail]/[degraded]
  → dedupe(todos) → winners + stats de merge
  → filter_vs_existing(conn, winners): skip vs comunidade (source IS NULL)
  → upsert(conn, winners)  # active por expiração, first_seen/last_seen
  → reconcile: dupes externas antigas (mesma chave, id diferente) → active=0
  → sweep: externos expirados ainda ativos → active=0
  → relatório por fonte + totais
```

### Funções novas (todas puras/testáveis exceto I/O)

```python
norm_name(s) -> str                      # lowercase, só [a-z0-9]
dedupe_key(row) -> str                   # norm(name)|YYYY-MM-DD
metadata_score(row) -> float
merge_rows(group) -> row                 # vencedor + fill de campos + union tags + source combinada
dedupe(rows) -> (winners, merges)
is_hackathon(name, tags=None, description=None) -> bool
is_expired(row, now) -> bool
ensure_schema(conn)                      # CREATE IF NOT EXISTS + ALTERs idempotentes
filter_vs_existing(conn, rows) -> (kept, skipped)   # skip vs comunidade
deactivate_stale_dupes(conn, winners) -> n
sweep_expired(conn, now) -> n
```

### Testes (`scripts/test_scrape_radar.py`, asserts puros)

- dedupe: duas fontes, mesmo nome (casing/espaços diferentes) + mesma data → 1 linha, vence a mais rica, `source` combinada
- classificador: rejeita "DevOps Summit", "Meetup de dados", "Webinar X"; aceita "Hackathon X", "NASA Space Apps Challenge", e "… Summit Hackathon" (hack vence deny)
- expiração: `upsert` em `:memory:` (via `ensure_schema`) → passado `active=0`, futuro `active=1`; `sweep_expired` desativa externo velho sem tocar comunidade
- comunidade: linha `source IS NULL` com mesma chave → raspado é skipado por `filter_vs_existing`

### quickstart.md (verificação)

1. `npm run test:scrape` verde
2. `npm run scrape` → relatório por fonte; 2ª rodada adiciona 0 linhas novas
3. SQL: zero dupes ativos por (nome normalizado, data)

## Riscos conhecidos (fora do escopo, reportar)

- `lib/db.ts` ao boot do Next desativa (`active=0`) **toda** linha fora do seed sem `registrations` — incluindo externos raspados. O scraper marca `active` certo, mas o próximo `npm run dev` reverte. Correção é app-side (provável `AND source IS NULL` no UPDATE) — não tocada aqui por restrição de escopo.
