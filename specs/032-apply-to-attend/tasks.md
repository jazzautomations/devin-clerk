# Tasks: Edições Curadas — "Pedir Lugar"

**Feature**: `032-apply-to-attend` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/apply-to-attend.test.ts` — register pending vs approved; sem carta/XP/badge até approve; getRegistrationIds/getRegistrationsByHackathon só approved; listRegistrants com status+memberId (pendentes primeiro); reviewRegistration approve/reject/idempotente/404; contagens approved-only (xp.regs, members.campaigns, getMemberArc)
- [x] T1.2 `lib/registrations.ts`: ALTERs guardados (hackathons.requiresApproval, registrations.status, reviewedAt); `RegistrationStatus`; register→{status,created}; `getRegistrationStatus`; `completeRegistration` (recompensa única); `reviewRegistration`; reads filtrados approved; listRegistrants +status/memberId/reviewedAt, pendentes primeiro
- [x] T1.3 `lib/hackathons.ts`: `Hackathon.requiresApproval` (+Row/toHackathon); `lib/admin.ts`: patch+setter (+guarda de schema via import de registrations)
- [x] T1.4 `lib/xp.ts`, `lib/members.ts`, `lib/archive.ts`: contagens/arco filtram `status='approved'` + guarda de ALTER própria

## Fase 2 — API

- [x] T2.1 Testes falhando: `tests/api/apply-to-attend.test.ts` — POST register pending 201/200-idempotente + `status` field; GET status; DELETE cancela pedido; PATCH admin registrations 200/400/403/404; PATCH hackathon requiresApproval; gates 403 (team/team-board/mural) pra pendente
- [x] T2.2 `app/api/hackathons/[id]/register/route.ts` — POST status-aware + GET novo
- [x] T2.3 `app/api/admin/hackathons/[id]/route.ts` — whitelist requiresApproval; `app/api/admin/hackathons/[id]/registrations/[memberId]/route.ts` novo (PATCH)

## Fase 3 — UI

- [x] T3.1 Teste BDD falhando: `tests/e2e/apply-to-attend.spec.ts` — seed edição requiresApproval=1 via better-sqlite3; anon vê "pedir lugar" (card + página); POST/PATCH/GET anon → 401 JSON
- [x] T3.2 `components/RegisterButton.tsx` — estados pending/rejected/approved + labels; `components/HackathonCard.tsx` — pedir lugar + fetch de status; `components/RegistrationActions.tsx` novo; `components/EditEventForm.tsx` — checkbox
- [x] T3.3 `app/h/[id]/page.tsx` — diff mínimo: myStatus + props no CTA (attendees já filtra via lib); `app/admin/page.tsx` — só seção inscritos (chip + ações + contagem pendente) e prop `requiresApproval` no EditEventForm

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
