# Implementation Plan: Admin Operacional

**Branch**: `004-admin-ops` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

## Summary

`/admin` vira ferramenta operacional: PATCH parcial de edição
(`lib/admin.ts → updateHackathon`), lista de inscritos por edição com e-mail
(`lib/registrations.ts → listRegistrants`) e exportação CSV da newsletter
(`listSubscribers` + `?format=csv`). UI: cada edição vira `<details>`
expansível com tabela de inscritos + `EditEventForm` (cliente) chamando o
PATCH. TDD: testes de lib/API falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — zero migração, tabelas já existem
- **Testing**: Vitest (unit+API, Clerk mockado por arquivo) + Playwright (guards 401 + redirect /admin)
- **Padrão de rotas**: igual `teams/route.ts` — `await auth()` → `!member` 401 → `role!=='admin'` 403 → `!getHackathon(id)` 404

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: ferramenta interna do organizador, nada atrás de paywall ✅
- III. Auth: tudo sob `/api/admin/*` com role check; e-mail nunca em rota pública ✅
- IV. One-session scope: 3 rotas + 1 lib + UI no painel existente ✅
- V. No slop UI: `<details>` nativo + tokens existentes, sem lib nova ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Update parcial | `updateHackathon(id, patch)` em `lib/admin.ts` novo com SET dinâmico por campo presente | `lib/hackathons.ts` é de leitura/filtros — não tocar; SET dinâmico permite `null` explícito (limpar campo) vs. ausente (não mexer) |
| Inscritos com e-mail | `listRegistrants(hackathonId)` novo em `lib/registrations.ts` (join members, inclui email) | `getRegistrationsByHackathon` é consumido pela página pública `/h/[id]` — manter sem e-mail por privacidade |
| Render da lista | Server component consulta a lib direto; `<details>` nativo | Requisito do briefing; sem fetch no cliente, sem estado React |
| CSV | Gerado na rota (`format=csv`), escape RFC4180 mínimo | Sem dependência; assinante é `email,createdAt` — duas colunas |
| Form de edição | `components/EditEventForm.tsx` client, `datetime-local`/`select`/checkbox → PATCH → reload | Mesmo padrão de `CreateEventForm` |
| Tabela global de inscrições | Removida — substituída pelos `<details>` por edição | Assumption da spec; evita dados duplicados na tela |

## Phase 1 — Design

### contracts

- `PATCH /api/admin/hackathons/[id]` — body parcial `{name?, startsAt?, endsAt?, format?, location?, registrationUrl?, registrationDeadline?, tags?: string[], active?: boolean}` → `200 {hackathon}`; `400` validação/patch vazio; `401` deslogado; `403` não-admin; `404` edição inexistente.
- `GET /api/admin/hackathons/[id]/registrations` → `200 {registrations: [{username, name, email, createdAt}]}` ordenado por `createdAt`; `401`/`403`/`404`.
- `GET /api/admin/subscribers` → `200 {subscribers: [{email, createdAt}]}`; `?format=csv` → `200 text/csv` + `Content-Disposition: attachment`. `401`/`403`.

### UI (`app/admin/page.tsx`)

- Seção "edições": cada linha vira `<details>` — summary com nome/data/inscritos/status; corpo com tabela de inscritos da edição + `<EditEventForm event={...} />`.
- Seção "newsletter": mantém lista + link `exportar csv` → `/api/admin/subscribers?format=csv`.
- Query de eventos passa a selecionar todos os campos editáveis (`h.*` já cobre — tipar).

### quickstart

1. `npm run test` verde; `npm run test:e2e` verde
2. Login admin → `/admin` → expandir edição → inscritos visíveis
3. Editar `location` → salvar → `/h/[id]` reflete
4. `curl -b sessão /api/admin/subscribers?format=csv` → baixa CSV
