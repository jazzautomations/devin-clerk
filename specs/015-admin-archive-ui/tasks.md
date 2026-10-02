# Tasks: Admin — UI do Arquivo de Edições

**Feature**: `015-admin-archive-ui` | APIs/lib já cobertas no spec 003 — aqui a cobertura nova é só dos gaps de validação.

## Fase 1 — Testes (gaps da API)

- [x] T1.1 `tests/api/archive.test.ts`: 400 em projeto com URL inválida; 400 em asset sem `type`/`url`
- [x] T1.2 `tests/e2e/admin.spec.ts`: POST teams/assets respondem 401 deslogado

## Fase 2 — UI

- [x] T2.1 `components/ArchiveForms.tsx`: `TeamForm` (nome, placement select 0–3, memberUsernames por vírgula, "+ projeto" com title/description/repoUrl/demoUrl, aviso de ignoredUsernames) + `AssetForm` (type/url/caption)
- [x] T2.2 `app/admin/page.tsx`: seção "// arquivo" por edição — resumo server-rendered (`getArchive`: times por colocação + contagem de materiais) + os dois forms

## Fase 3 — Gate

- [x] T3.1 lint + typecheck + build + test + test:e2e verdes
- [ ] T3.2 verificação manual do spec (login admin → cadastro <1min) — pelo usuário
