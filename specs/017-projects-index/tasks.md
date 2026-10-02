# Tasks: Índice de Projetos

**Feature**: `017-projects-index` | TDD: testes antes da implementação.

## Fase 1 — lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/projects-index.test.ts` — listProjects ordena pódio→participante→edição recente, INNER JOIN exclui time sem projeto, memberCount, liveDeployId só quando último deploy running, filtros `hackathonId`/`liveOnly`, listProjectEditions
- [x] T1.2 `lib/projects.ts`: listProjects + listProjectEditions

## Fase 2 — Render pública

- [x] T2.1 Teste BDD falhando: `tests/e2e/projects-index.spec.ts` — heading + card seed → /p, badge lendário, link edição → /h, filtro ?h=, empty state, link no header, canonical
- [x] T2.2 `app/projetos/page.tsx`: heading "// projetos", grid de cards, chips de edição + "só ao vivo", metadata + canonical
- [x] T2.3 `lib/seo.ts`: `/projetos` no STATIC_ROUTES; `components/Header.tsx`: link "projetos" na nav

## Fase 3 — Gate

- [x] T3.1 lint + typecheck + build + test + test:e2e verdes
