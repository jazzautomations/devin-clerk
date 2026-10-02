# Implementation Plan: Moderação do Feed

**Branch**: `018-feed-moderation` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Feed ganha deleção autor-ou-admin: `deletePost`/`deleteComment` em
`lib/posts.ts` (cascata transacional de likes+comments), `DELETE` em
`/api/posts/[id]` e `/api/posts/[id]/comments/[commentId]` com guards
401/403/404, e "✕" por linha no `FeedSection` (props novas `me`/`isAdmin`,
confirmação + update local). TDD: testes de lib/API/e2e falhando antes de
implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — zero schema change (cascata é em código, FK já existem)
- **Testing**: Vitest (unit + API, Clerk mockado, db `:memory:`) + Playwright (DELETE anon → 401 via request)
- **Padrão de dados**: funções novas em `lib/posts.ts` — mesmo estilo (prepare + transaction); permissão derivada de `Member` (`id` + `role`)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: leitura pública intacta; moderação é self-service + admin ✅
- III. Auth: escrita só via API autenticada, 401 JSON deslogado ✅
- IV. One-session scope: 2 funções + 2 rotas + controle de UI + testes ✅
- V. No slop UI: "✕" discreto na linha existente, não toolbar/modal genérico ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde mora o delete | `deletePost`/`deleteComment` em `lib/posts.ts` recebendo `Member` | Permissão precisa de `role`+`id` — o membro inteiro entra, não só o id; lib decide tudo e route só mapeia pra HTTP |
| Permissão | `requester.role === 'admin' \|\| row.memberId === requester.id` | Mesma regra pros dois recursos; admin modera tudo |
| Cascata | `DELETE likes → post_comments → posts` em `db.transaction` | Nenhum filho pode sobrar órfão; falha no meio reverte tudo |
| 404 vs 403 | Route checa existência antes de chamar a lib | Não vaza se o id existe pra quem não pode apagar (alheio + inexistente divergem só depois do exist-check) |
| Comment fora do post | Route compara `comment.postId !== postId` → 404 | URL canônica: `/posts/[id]/comments/[cid]` só apaga dentro do post certo |
| Retorno | `{ok: true}` 200 / `{error}` 401·403·404 | Mesmo vocabulário dos endpoints existentes |
| Controle na UI | "✕" com `confirm()`, visível quando `isAdmin \|\| username === me` | Minimal diff: props novas `me`/`isAdmin` — `canPost` continua só pra composer |
| Update local | remove do state otimista; falha → refetch (`GET /api/posts` / thread) | Feed já vive em state local — apagar é só um `setPosts`/`setThreads` |

## Phase 1 — Design

### data-model.md

Nenhuma migração. Deleção usa as FKs existentes:

```sql
posts(id, memberId→members, …)
likes(postId→posts, memberId→members)
post_comments(id, postId→posts, memberId→members, …)
```

### contracts/api.md

- `DELETE /api/posts/[id]` → 200 `{ok:true}`; 401 deslogado/sem member; 403 não-autor-e-não-admin; 404 inexistente/inválido
- `DELETE /api/posts/[id]/comments/[commentId]` → idem; 404 também quando o comentário é de outro post
- Sem mudança em GETs: leitura pública continua sem campo novo

### Render

- `FeedSection` ganha props opcionais `me?: string | null` e `isAdmin?: boolean`; `/feed` passa de `member`, `/dashboard` idem (sempre tem member)
- Post: "✕" ao lado do timestamp quando `isAdmin || p.username === me`; comentário: mesma regra com `c.username`
- `confirm()` → DELETE otimista → falha refaz fetch da lista/thread

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl -X DELETE /api/posts/1` deslogado → 401 JSON
3. Logado → "✕" no teu post → confirma → some na hora; admin vê "✕" em tudo
