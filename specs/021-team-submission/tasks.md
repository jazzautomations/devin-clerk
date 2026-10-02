# Tasks: Submissão de Time pelo Membro

**Feature**: `021-team-submission` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/teams.test.ts` — memberTeamFor; submitTeam (inscrito-only nos colegas, autor auto-entra, placement forçado 0, 409 nome/autor, URLs); updateTeamProject (integrante edita, estranho 403, upsert, limpa campo)
- [x] T1.2 `lib/teams.ts`: `TeamError`, `memberTeamFor`, `submitTeam`, `updateTeamProject`
- [x] T1.3 `lib/game.ts`: `XP.teamSubmit = 15`

## Fase 2 — API do membro

- [x] T2.1 Teste falhando: `tests/api/team.test.ts` — GET 401/404/200; POST 401/404/403-inscreve/400/409×2/201+xp; PATCH 401/404/403/200
- [x] T2.2 `app/api/hackathons/[id]/team/route.ts` — GET/POST/PATCH

## Fase 3 — UI na página da edição

- [x] T3.1 Teste BDD falhando: `tests/e2e/team-submission.spec.ts` — anon não vê form; POST/PATCH/GET deslogado → 401 JSON
- [x] T3.2 `components/MyTeamPanel.tsx` (client) — criar OU editar, link `/p/[teamId]`
- [x] T3.3 `app/h/[id]/page.tsx` — seção "meu time" quando `!past && registered` (diff mínimo)

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
