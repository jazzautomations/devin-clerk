# Tasks: Escolha do Povo — voto da comunidade em projetos

**Feature**: `025-peoples-choice` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/votes.test.ts` — toggleVote (liga/desliga, 404 sem projeto, 403 próprio time), dedupe pela PK, hasVoted, voteCountFor, getVoteCounts, listProjects com voteCount/votedByMe/sort=votes
- [x] T1.2 `lib/votes.ts`: schema idempotente + `VoteError` + `toggleVote` + `hasVoted` + `voteCountFor` + `getVoteCounts`

## Fase 2 — API do membro

- [x] T2.1 Teste falhando: `tests/api/votes.test.ts` — POST 401 (anon e clerkId sem member), 404 (id inválido/inexistente/sem projeto), 403 (integrante), 200 toggle `{voted,count}`
- [x] T2.2 `app/api/projects/[teamId]/vote/route.ts` — POST

## Fase 3 — UI pública

- [x] T3.1 `lib/projects.ts`: `voteCount`/`votedByMe`/`sort:"votes"` no `listProjects`
- [x] T3.2 `components/VoteButton.tsx` (client): ▲/△ + contagem, otimista, 401 → `/sign-in`, disabled no próprio time; `app/p/[teamId]/page.tsx` recebe o bloco (diff mínimo)
- [x] T3.3 `app/projetos/page.tsx`: `▲ N` nos cards + chip `escolha do povo` preservando `h`/`live`/`q`

## Fase 4 — E2E + gate

- [x] T4.1 Teste BDD: `tests/e2e/peoples-choice.spec.ts` — `▲` no card, chip `sort=votes` existe e ordena, POST anon → 401 JSON, clique anon na ficha → `/sign-in`
- [x] T4.2 lint + typecheck + build + test + test:e2e verdes

## Decisões registradas

- Voto **não** paga XP nem badge (sinal ≠ moeda) — `lib/game.ts`/`lib/xp.ts` intactos
- Self-vote bloqueado (403) — sinal da comunidade, não autopromoção
- Sem vote nos cards do índice — placar visível, clique navega pra ficha
