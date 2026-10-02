# Tasks: Busca + OG dinâmico

**Feature**: `023-search-og` | TDD: testes antes da implementação.

## Fase 1 — Libs de busca (testes primeiro)

- [ ] T1.1 Testes falhando: `tests/unit/search.test.ts` — searchHackathons (nome/local/tag, case, vazio), listLeaderboard q (username/name/headline/skills + escape de `%`/`_`), listProjects q (título/descrição/time + escape)
- [ ] T1.2 `lib/hackathons.ts`: `searchHackathons(q, now)`
- [ ] T1.3 `lib/members.ts`: `listLeaderboard(sort, limit, q)` com LIKE escapado
- [ ] T1.4 `lib/projects.ts`: `ProjectFilter.q` com LIKE escapado

## Fase 2 — UI das páginas

- [ ] T2.1 `app/radar/page.tsx`: searchParams q + form + empty state de busca
- [ ] T2.2 `app/membros/page.tsx`: q no leaderboard + form (hidden `sort`) + chips preservam q
- [ ] T2.3 `app/projetos/page.tsx`: q no filtro + form (hidden `h`/`live`) + chips preservam q

## Fase 3 — OG dinâmico

- [ ] T3.1 `app/h/[id]/opengraph-image.tsx`: nome + data + local + borda por raridade + fallback
- [ ] T3.2 `app/p/[teamId]/opengraph-image.tsx`: título + edição + colocação

## Fase 4 — Gate

- [ ] T4.1 `tests/e2e/search-og.spec.ts`: ?q= nas três páginas + og 200 image/png
- [ ] T4.2 lint + typecheck + build + test + test:e2e verdes
