# Tasks: Páginas de Projeto

**Feature**: `010-project-pages` | TDD: testes antes da implementação.

## Fase 1 — Query do arquivo (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/projects.test.ts` — getProjectByTeamId retorna null pra teamId inexistente, null pra time sem projeto, e estrutura completa (team + project + members ordenados + edição) quando existe
- [x] T1.2 `lib/archive.ts`: `getProjectByTeamId(teamId)` — JOIN teams/hackathons/team_projects + team_members, type `ProjectPage`

## Fase 2 — Rota pública (testes primeiro)

- [x] T2.1 Teste BDD falhando: `tests/e2e/project.spec.ts` — click-through do arquivo pro `/p/<id>`, título + link da edição, 404 em id desconhecido, `og:title` presente
- [x] T2.2 `app/p/[teamId]/page.tsx` — ficha do projeto (título display, edição linkada, badge de colocação 1º lendário, descrição, repo/demo, membros → `/u/[username]`, CTA demo ao vivo quando deploy running) + `generateMetadata`
- [x] T2.3 Wiring: `/h/[id]/page.tsx` envolve títulos de projeto (pódio + field) em `<Link href={/p/...}>`; `/u/[username]/page.tsx` envolve título do projeto (só quando existe)

## Fase 3 — Gate

- [x] T3.1 lint + typecheck + build + test + test:e2e verdes
- [x] T3.2 spec/tasks atualizadas com status final
