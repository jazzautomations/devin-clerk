# Tasks: Prêmio nos Cards do Radar

**Feature**: `024-prize-cards` | TDD: testes antes da implementação.

## Fase 1 — Schema + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/prize.test.ts` — getHackathon retorna prize (seed Unifacens "R$ 5 mil"); updateHackathon define/limpa; admin PATCH aceita prize e rejeita tipo errado
- [x] T1.2 `lib/db.ts`: `ALTER TABLE … ADD COLUMN prize TEXT` guardado por PRAGMA; insert de seed com `prize`; backfill `UPDATE … WHERE prize IS NULL`
- [x] T1.3 `lib/hackathons.ts` `prize: string | null`; `data/hackathons.ts` declara o campo (Unifacens "R$ 5 mil", demais null)
- [x] T1.4 `lib/admin.ts` `HackathonPatch.prize` + `updateHackathon`; rotas admin POST/PATCH aceitam `prize`

## Fase 2 — Scraper (testes primeiro)

- [x] T2.1 Testes falhando em `scripts/test_scrape_radar.py`: strip de `prize_amount` ("$138,000"; "$0"→None); taikai prize+currency→display; merge herda prize; upsert grava coluna
- [x] T2.2 `scrape_radar.py`: `ensure_schema` + `UPSERT_SQL` com `prize`; `metadata_score`/`merge_rows` cobrem o campo; `src_devpost`/`src_taikai`/`src_curated` emitem `prize`

## Fase 3 — UI

- [x] T3.1 Teste BDD falhando: `tests/e2e/prize-cards.spec.ts` — card do radar mostra chip lendário com o valor; card sem prize não mostra a linha; OG com prize → 200
- [x] T3.2 `components/HackathonCard.tsx`: linha "prêmio" `text-lendario` no `<dl>` quando `prize`
- [x] T3.3 `app/h/[id]/opengraph-image.tsx`: `h.prize` na linha de detalhe

## Fase 4 — Gate

- [x] T4.1 `npm run scrape` real → 46 eventos com prize (26 devpost, 17 taikai, 1 curadoria, 1 seed, 1 e2e); 28 ativos
- [x] T4.2 lint + typecheck + build + test + test:scrape + test:e2e verdes
- [x] T4.3 spec/tasks atualizadas (checkboxes)
