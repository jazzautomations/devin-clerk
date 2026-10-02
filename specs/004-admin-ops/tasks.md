# Tasks: Admin Operacional

**Feature**: `004-admin-ops` | TDD: testes antes da implementação.

## Fase 1 — Libs (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/admin.test.ts` — `updateHackathon` aplica patch parcial preservando o resto, aceita `null` pra limpar campo, retorna `null` pra id inexistente; `listSubscribers` retorna `{email, createdAt}` ordenado; `listRegistrants` com e-mail
- [x] T1.2 `lib/admin.ts`: `updateHackathon` (SET dinâmico por campo presente) + `listSubscribers`; `lib/registrations.ts`: `listRegistrants` com e-mail

## Fase 2 — APIs admin

- [x] T2.1 Teste falhando: `tests/api/admin-ops.test.ts` — PATCH 200/400/404; GET registrations 200+404; GET subscribers json+csv
- [x] T2.2 Teste falhando: `tests/api/admin-ops-guards.test.ts` — 403 não-admin nas 3 rotas; `tests/api/auth.test.ts` — 401 deslogado nas 3 rotas
- [x] T2.3 `app/api/admin/hackathons/[id]/route.ts` (PATCH) + `[id]/registrations/route.ts` (GET) + `app/api/admin/subscribers/route.ts` (GET json/csv)

## Fase 3 — UI admin

- [x] T3.1 `components/EditEventForm.tsx` — form cliente que chama PATCH e recarrega
- [x] T3.2 `app/admin/page.tsx` — edições como `<details>` com inscritos por edição (lib direto, server-side) + form de edição; newsletter com link CSV; remove tabela global de inscrições

## Fase 4 — E2E + Gate

- [x] T4.1 `tests/e2e/admin.spec.ts` — APIs admin 401 sem login; `/admin` redireciona pro sign-in
- [x] T4.2 lint + typecheck + build + test + test:e2e verdes
