# Implementation Plan: Notificações

**Branch**: `013-notifications` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Sino no header com badge de não-lidas + dropdown, alimentado por gatilhos nas
rotas de like e comentário. Tabela própria em `lib/notifications.ts` (pattern
`lib/deploys.ts` — `CREATE TABLE IF NOT EXISTS` no módulo, sem editar
`lib/db.ts`, que está sendo tocado por feature paralela). TDD: testes de
lib/API falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite — tabela `notifications` criada pelo próprio `lib/notifications.ts`
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (BDD público)
- **UI**: `components/NotificationBell.tsx` (client island) dentro de `<Show when="signed-in">` no `Header.tsx`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: fecha o loop de feedback social ✅
- III. Auth: leitura/escrita só do próprio membro, 401 deslogado ✅
- IV. One-session scope: lib + 1 API + 2 gatilhos + 1 componente ✅
- V. No slop UI: badge real com contagem, dropdown com tempo e ação ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde o schema vive | `lib/notifications.ts` com `db.exec` próprio | `lib/db.ts` está sob edição paralela — pattern `deploys.ts` já provado no repo |
| Self-skip | `notify()` compara `actorUsername` com o username do destinatário | Regra em um lugar só; rotas não precisam lembrar do edge case |
| Texto da notificação | Composto na rota (`@x curtiu teu post`), salvo pronto | Render barato; recado congelado sobrevive a rename de username |
| Identidade do ator | `actorUsername` TEXT, não FK | O recado é histórico — texto não quebra se o membro sair |
| Atualização do badge | fetch no mount + refetch ao abrir dropdown | Polling de 30s é custo sem ganho no v1; abrir já refaz o fetch |
| href | `/feed` fixo | Sem âncora por post no markup atual — simples e correto |

## Phase 1 — Design

### data-model.md

```sql
notifications: id PK AUTOINCREMENT, memberId→members, actorUsername TEXT NULL,
               type TEXT, text TEXT, href TEXT NULL, read INT DEFAULT 0,
               createdAt DEFAULT datetime('now')
idx_notifications_member_read: (memberId, read)
```

### lib

- `notify(memberId, {type, actorUsername?, text, href?})` — self-skip interno
- `listNotifications(memberId, limit=50)` — DESC por id
- `unreadCount(memberId)` — COUNT WHERE read=0
- `markAllRead(memberId)` / `markRead(id, memberId)` — escopo por memberId

### contracts/api.md

- `GET /api/notifications` → `{notifications[], unread}` — 401 deslogado
- `POST /api/notifications` `{action:"readAll"}` ou `{id:number}` → `{ok:true}`; 400 inválido; 401 deslogado

### gatilhos (2 linhas cada, nas rotas existentes)

- `app/api/posts/[id]/like/route.ts`: dentro do `if (liked)` → `notify(author.memberId, {type:"like", ...})`
- `app/api/posts/[id]/comments/route.ts`: após `createComment` → `notify(author.memberId, {type:"comment", ...})`

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. Seed de notificação + login → badge aparece; clique abre lista; "marcar tudo lido" zera
3. Deslogado: sem sino no header; `curl /api/notifications` → 401
