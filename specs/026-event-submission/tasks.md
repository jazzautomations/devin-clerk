# Tasks: Indicação de Hackathon pela Comunidade

**Feature**: `026-event-submission` | TDD: testes antes da implementação.

## Fase 1 — lib submissions (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/submissions.test.ts` — createSubmission (defaults, name/url obrigatórios, url só http(s), format whitelist+default, startsAt parseável), dedupe 24h por url, listPendingSubmissions ASC, slugify/uniqueHackathonId (nome+ano, sufixo), reviewSubmission (approve cria hackathon source='comunidade'/organizer/org:da nota, reject marca, id desconhecido null, re-revisão no-op)
- [x] T1.2 `lib/submissions.ts`: schema idempotente (CREATE TABLE + INDEX) + createSubmission + listPendingSubmissions + getSubmission + reviewSubmission + slugify

## Fase 2 — APIs

- [x] T2.1 Testes falhando: `tests/api/submissions.test.ts` (mock admin) — POST público 201/400/honeypot/dedupe; GET 200 lista pending; POST admin approve→hackathon/reject/404/400-action. `tests/api/submissions-guards.test.ts` (mock member) — GET 403, rota admin 403
- [x] T2.2 `app/api/submissions/route.ts` — POST público (honeypot `company`, dedupe) + GET admin-only
- [x] T2.3 `app/api/admin/submissions/[id]/route.ts` — POST action=approve|reject, 404 id

## Fase 3 — UI (radar + admin)

- [x] T3.1 Teste BDD falhando: `tests/e2e/submissions.spec.ts` — /radar mostra bloco "// indica um hackathon"; POST anon → 201; honeypot → 201 sem gravar; GET /api/submissions + POST admin anon → 401
- [x] T3.2 `components/SubmitEventForm.tsx` (client, honeypot `company` hidden, sucesso "vai pra curadoria") + `components/SubmissionActions.tsx` (client, aprovar/recusar)
- [x] T3.3 `app/radar/page.tsx` — `<details>` no fim; `app/admin/page.tsx` — seção "// indicações" apensa (diff mínimo)

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
