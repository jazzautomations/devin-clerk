# Tasks: Arquivo de Edições

**Feature**: `003-edition-archive` | TDD: testes antes da implementação.

## Fase 1 — Schema + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/archive.test.ts` — createTeam ordena por placement, linkMembers ignora username inexistente, getArchive retorna estrutura, addAsset valida tipo/url
- [x] T1.2 `lib/db.ts`: tabelas `teams`, `team_members`, `team_projects`, `edition_assets` + seed pódio Unifacens
- [x] T1.3 `lib/archive.ts`: getArchive, createTeam, addAsset, getMemberProjects

## Fase 2 — API admin

- [x] T2.1 Teste falhando: `tests/api/archive.test.ts` — POST teams 201/403/401/404 + ignoredUsernames
- [x] T2.2 `app/api/admin/hackathons/[id]/teams/route.ts` + `assets/route.ts`

## Fase 3 — Render pública

- [x] T3.1 Teste BDD falhando: `tests/e2e/archive.spec.ts` — pódio Unifacens, repo abre em nova aba, edição futura sem seção
- [x] T3.2 `/h/[id]/page.tsx`: seção resultado (pódio + times + assets)
- [x] T3.3 `/u/[username]/page.tsx`: projetos vinculados nas campanhas

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 commit + spec atualizada
