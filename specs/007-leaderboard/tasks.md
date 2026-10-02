# Tasks: Leaderboard de Membros

**Feature**: `007-leaderboard` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/leaderboard.test.ts` — xp desc + desempate username asc, contagens de badges/campanhas/cartinhas, `sort=recent` por createdAt desc, limite
- [x] T1.2 `lib/members.ts`: `listLeaderboard(sort, limit)` + `Member.badges`

## Fase 2 — Render pública

- [x] T2.1 Teste BDD falhando: `tests/e2e/leaderboard.spec.ts` — ranking numerado, `data-rank="1"` com token lendário, link `/u/[username]`, toggle `?sort=recent` (atualiza heading em `public.spec.ts`)
- [x] T2.2 `app/membros/page.tsx`: `<ol>` numerada, pódio lendário/épico/raro, `XpBar` por linha, chips de ordenação

## Fase 3 — Gate

- [x] T3.1 lint + typecheck + build + test + test:e2e verdes — exceto falhas pré-existentes do WIP 006/008 (ver nota)
- [x] T3.2 PRD atualizado (`/membros` = leaderboard) + spec revisada

## Nota — gate parcialmente bloqueado por WIP paralelo

O worktree contém trabalho em andamento de outras features (006-sponsored-challenges,
008-deploy-tool) que falham independente do 007:

- `tests/api/deploys.test.ts`: 2 falhas (espera 409, recebe 400; GET retorna null) + 12 erros TS — quebra `typecheck` e `build`
- `tests/e2e/challenges.spec.ts`: 1 falha (strict mode — "jornada do paciente" resolve 2 elementos)
- `lib/deploys.ts`: 1 warning eslint (`CONTAINER_PORT` não usado)

Escopo 007 está verde isolado: 4/4 unit, 2/2 e2e, lint/typecheck limpos,
`next build` compila todas as rotas (falha só no type-check do arquivo 008).
