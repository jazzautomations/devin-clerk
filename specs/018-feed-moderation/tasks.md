# Tasks: Moderação do Feed

**Feature**: `018-feed-moderation` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/moderation.test.ts` — deletePost autor ok / admin ok / stranger false / inexistente false / cascata zera likes+comments; deleteComment idem
- [x] T1.2 `lib/posts.ts`: `deletePost(postId, requester)` e `deleteComment(commentId, requester)` — permissão autor-ou-admin, cascata em transação

## Fase 2 — API

- [x] T2.1 Testes falhando: `tests/api/moderation.test.ts` — DELETE post 401/404/403/200 autor/200 admin; DELETE comment idem + comment de outro post → 404; + casos 401 em `auth.test.ts`
- [x] T2.2 `app/api/posts/[id]/route.ts` (DELETE) + `app/api/posts/[id]/comments/[commentId]/route.ts` (DELETE)

## Fase 3 — Render

- [x] T3.1 Teste BDD falhando: `tests/e2e/moderation.spec.ts` — DELETE anon → 401 nos dois endpoints; anon não vê "apagar" no feed
- [x] T3.2 `components/FeedSection.tsx`: props `me`/`isAdmin` + "✕" com confirm em post e comentário + update local otimista; `app/feed/page.tsx` e `app/dashboard/page.tsx` passam as props

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
