# Tasks: "Procuro time" (formação de equipe por edição)

**Feature**: `012-team-finder` | TDD: testes antes da implementação.

## Fase 1 — Schema + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/teamboard.test.ts` — validateBoardInput (need 1–200, note ≤300, skills sanitiza), upsertBoardEntry insert/update/reativa, listBoardEntries só ativos ASC com join, deactivate idempotente, setBoardEntryActive
- [x] T1.2 `lib/teamboard.ts`: `looking_for_team` via `db.exec` próprio (não edita `lib/db.ts` — pattern `lib/deploys.ts`); `lib/game.ts`: `XP.teamBoard = 10`

## Fase 2 — API

- [x] T2.1 Teste falhando: `tests/api/team-board.test.ts` — GET público/404; POST 201+XP uma vez, 200 upsert, 401 deslogado, 403 não-inscrito, 400 validação, 404 edição; DELETE idempotente; PATCH admin 200/403/404
- [x] T2.2 `app/api/hackathons/[id]/team-board/route.ts`: GET + POST + DELETE + PATCH

## Fase 3 — Render pública + admin

- [x] T3.1 Teste BDD falhando: `tests/e2e/team-board.spec.ts` — anon vê entry seedada na página da edição, composer oculto, POST anon → 401
- [x] T3.2 `components/TeamBoardPanel.tsx` + seção `// quem tá procurando time` em `/h/[id]` (+ contagem em inscritos); edição past: sem composer, lista permanece
- [x] T3.3 `/admin`: anúncios por edição com `TeamBoardToggle` (PATCH)

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
