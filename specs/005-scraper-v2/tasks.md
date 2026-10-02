# Tasks: Scraper v2 — Radar Externo Confiável

**Feature**: `005-scraper-v2` | TDD: testes antes da implementação.

## Fase 1 — Núcleo testável (testes primeiro)

- [x] T1.1 `scripts/test_scrape_radar.py` falhando: dedupe merge (nome normalizado+data, vence ficha mais rica, source combinada), `is_hackathon` (rejeita "DevOps Summit"/"Meetup de dados"/"Webinar", aceita "Hackathon X"/"NASA Space Apps"/"Summit Hackathon"), expiração no `upsert` em `:memory:` (`ensure_schema`), `filter_vs_existing` skip vs comunidade
- [x] T1.2 `scrape_radar.py`: `norm_name`, `dedupe_key`, `metadata_score`, `merge_rows`, `dedupe`, `is_hackathon` (denylist + hack-terms), `is_expired`
- [x] T1.3 `ensure_schema` (CREATE IF NOT EXISTS + ALTER idempotente `first_seen`/`last_seen`/`source` + backfill), `upsert` com `active` calculado e `first_seen`/`last_seen`, `filter_vs_existing`, `deactivate_stale_dupes`, `sweep_expired`

## Fase 2 — Fontes

- [x] T2.1 Devpost: paginação `per_page=24`/`page` até `total_count` ou 5 páginas, `sleep(1.2)` entre páginas
- [x] T2.2 ETHGlobal: parser de cards tipados (`### BODY TIPO](url)`, só `Hackathon`), datas do primeiro range do BODY, fallback endpoints JSON, 0 → `[degraded]`
- [x] T2.3 Filtro `is_hackathon` aplicado em MLH/Meetup/Luma/curadoria (Devpost/TAIKAI isentos)

## Fase 3 — Pipeline + relatório

- [x] T3.1 `main()`: ensure_schema → coleta por fonte → dedupe → filter_vs_existing → upsert → deactivate_stale_dupes → sweep_expired → relatório por fonte (coletados → mantidos) e totais
- [x] T3.2 `package.json`: script `test:scrape`

## Fase 4 — Gate

- [x] T4.1 `npm run test:scrape` verde + `python -m py_compile` limpo
- [x] T4.2 `npm run scrape` real: relatório por fonte, 2ª rodada sem dupes novas; riscos app-side reportados (lib/db.ts desativa externos no boot)
