# Implementation Plan: Edições Curadas — "Pedir Lugar"

**Branch**: `main` (workshop tree — sem commit) | **Date**: 2026-12-19 | **Spec**: [spec.md](./spec.md)

## Summary

Edição marcada `requiresApproval` troca "inscrever-se em 1 clique" por
"pedir lugar": `register()` grava `status='pending'` e o funil de
recompensa (XP + carta + badges) sai de `register` pra
`completeRegistration`, chamado só quando a inscrição efetiva — no
register instantâneo (edição aberta) ou na aprovação admin
(`reviewRegistration`). `getRegistrationIds`/`getRegistrationsByHackathon`
filtram `approved`, então board/time/mural/perfil/dashboard herdam
"pendente = não inscrito" de graça. Admin ganha `PATCH
…/registrations/[memberId] {action}` + botões na lista de inscritos e o
checkbox "curadoria" no `EditEventForm`. TDD: unit/API/e2e falhando antes.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — NÃO edita; ALTERs guardados por arquivo (pattern `avatarUrl`/`memberCols`)
- **Testing**: Vitest (unit+API, Clerk mockado, `HACKAHUB_DB=:memory:`) + Playwright (anon, seed via better-sqlite3 no db do dev server)
- **Erros**: rotas mapeiam null/validação direto (sem classe de erro nova — review retorna `null` → 404)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅
- II. Community-first: curadoria transparente — pendente/rejeitado têm estado honesto, não sumiço ✅
- III. Auth: escrita autenticada; decisão só admin; leitura pública intacta ✅
- IV. One-session scope: coluna + flag + review + UI ✅
- V. No slop UI: chip "pendente" e CTA contextual, não CRUD genérico ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde moram os ALTERs | `lib/registrations.ts` (`requiresApproval`, `status`, `reviewedAt`); guardas duplicadas em `lib/xp.ts`, `lib/members.ts`, `lib/archive.ts` que passam a filtrar por `status` | pattern da casa: quem lê a coluna garante o ALTER (ver comentário `avatarUrl` em registrations.ts) — sobrevive a import em qualquer ordem |
| Recompensa | `completeRegistration` em `lib/registrations.ts` — única porta de `awardXp+mintCard+checkBadges` pra inscrição | register instantâneo e aprovação admin compartilham o MESMO caminho; pendente nunca passa por ele |
| Status persistido | `status` na linha + `reviewedAt`; rejeitado NÃO é deletado | honestidade/auditoria; "não rolou dessa vez" precisa do estado |
| `getRegistrationIds` | só `approved` | TODOS os gates (board 012, team 021, mural 028, dashboard, perfil) herdam; pendente vaza só pelo check de colega inline em `lib/teams.ts` (arquivo congelado — débito documentado no spec) |
| `listRegistrants` (admin) | todos os status, pendentes primeiro, + `memberId` | a ação admin é por memberId; pendente no topo = fila de trabalho |
| API register | POST → 201 `pending` (criado) / 200 (já pendente ou aprovado); GET novo `{status}`; DELETE cancela | GET alimenta o estado inicial do `HackathonCard` sem re-render da página |
| Admin review | `PATCH …/registrations/[memberId] {action:'approve'\|'reject'}` | mesmo contrato do `…/submissions/[id]` (026) — approve idempotente sem XP duplo |
| HackathonCard | status inicial via `GET register` quando `requiresApproval && !registered` | radar page é intocável — o card resolve o próprio estado pendente |
| e2e | seed `requiresApproval=1` via better-sqlite3 com guarda de coluna (pattern `first_seen` do spec 027) | Clerk captcha bloqueia sign-up real — cobre anon: label, 401 JSON |

## Phase 1 — Design

### data-model.md

```sql
-- ALTERs guardados em lib/registrations.ts (idempotentes)
ALTER TABLE hackathons ADD COLUMN requiresApproval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'; -- 'pending'|'approved'|'rejected'
ALTER TABLE registrations ADD COLUMN reviewedAt TEXT; -- NULL enquanto pendente
```

Bancos existentes: todas as inscrições atuais viram `approved` (default) —
zero backfill. Fresh installs: `CREATE TABLE` do db.ts + ALTERs no import.

### contracts/api.md

- `POST /api/hackathons/[id]/register` — 401/404 como hoje →
  edição curada: `register()` grava pending → **201**
  `{registered:false, status:'pending', created:true}` (re-POST pendente
  → 200 `created:false`); edição aberta: `completeRegistration` →
  **200** `{registered:true, status:'approved', xp:'+50', cardSerial,
  newBadges}` (mesmo shape atual + `status`).
- `GET /api/hackathons/[id]/register` — 401 anon → 404 edição →
  200 `{status: 'pending'|'approved'|'rejected'|null}`.
- `DELETE` — inalterado (remove a linha em qualquer status).
- `PATCH /api/admin/hackathons/[id]` — whitelist + `requiresApproval`
  booleano (400 se outro tipo).
- `PATCH /api/admin/hackathons/[id]/registrations/[memberId]` —
  401 anon → 403 não-admin → 404 edição/memberId inválido →
  400 `{action}` fora de approve|reject → `reviewRegistration` →
  404 sem inscrição → **200**
  `{status:'approved', rewarded, xp, cardSerial, newBadges}` ou
  `{status:'rejected'}`.

### quickstart / UI

- `/h/[id]`: `myStatus = getRegistrationStatus(member.id, h.id)`;
  `registered = myStatus === 'approved'`; CTA recebe
  `requiresApproval + status`. Lista "inscritos" = aprovados (via lib).
- `RegisterButton`: label por estado — `approved` "✓ inscrito — cancelar
  inscrição"; `pending` "aguardando aprovação — cancelar pedido";
  `rejected` "não rolou dessa vez" (disabled); null+curada "pedir lugar";
  null+aberta "inscrever-se em 1 clique".
- `HackathonCard`: `hackathon.requiresApproval` → "pedir lugar"; se
  `!registered` faz `GET register` no mount pra status inicial.
- `/admin` (seção inscritos apenas): chip "pendente" +
  `RegistrationActions` (approve/reject, pattern `SubmissionActions`) +
  contagem "N pendentes"; `EditEventForm` + checkbox "curadoria".
