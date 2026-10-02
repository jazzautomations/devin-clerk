# Tasks: Comentários no Feed

**Feature**: `011-post-comments` | TDD: testes antes da implementação.

## Fase 1 — Schema + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/comments.test.ts` — createComment valida (vazio, >1000, trim), listComments ASC com autor, `commentCount` em listPosts, isolamento por post
- [x] T1.2 `lib/db.ts`: `post_comments` no exec principal (CREATE TABLE IF NOT EXISTS)
- [x] T1.3 `lib/comments.ts`: listComments, createComment; `lib/posts.ts`: `commentCount` no select + tipo; `lib/game.ts`: `XP.comment = 5`

## Fase 2 — API

- [x] T2.1 Teste falhando: `tests/api/comments.test.ts` — GET público ASC + 404; POST 201/+5XP, 401 deslogado, 401 sem member, 400 validação, 404 post inexistente; commentCount na listagem (+ caso 401 em `auth.test.ts`)
- [x] T2.2 `app/api/posts/[id]/comments/route.ts`: GET + POST

## Fase 3 — Render pública

- [x] T3.1 Teste BDD falhando: `tests/e2e/comments.spec.ts` — anon vê contagem e thread do post seedado, composer oculto, POST anon → 401
- [x] T3.2 `components/FeedSection.tsx`: contagem + thread expansível + composer pra membro

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
