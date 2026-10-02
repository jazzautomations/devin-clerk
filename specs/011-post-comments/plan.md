# Implementation Plan: Comentários no Feed

**Branch**: `011-post-comments` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Posts do `/feed` ganham thread de comentários: tabela `post_comments`
(migração idempotente em `lib/db.ts`), `lib/comments.ts` no estilo de
`lib/posts.ts`, API `/api/posts/[id]/comments` (GET público, POST
autenticado com +5 XP), `commentCount` via subselect na listagem de
posts e thread expansível no `FeedSection`. TDD: testes de lib/API/e2e
falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` (CREATE TABLE IF NOT EXISTS no exec principal — pattern existente)
- **Testing**: Vitest (unit + API, Clerk mockado, db `:memory:`) + Playwright (BDD público; e2e seeda post+comentários direto no `data/hackahub.db`)
- **Padrão de dados**: `lib/comments.ts` novo — mesmo estilo de `lib/posts.ts` (join members, select compartilhado)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: leitura pública, escrita gratuita pra membros ✅
- III. Auth: escrita só via API autenticada, 401 JSON deslogado ✅
- IV. One-session scope: tabela + lib + API + UI + testes em uma sessão ✅
- V. No slop UI: thread com mesma linguagem do post (LV chip, persona chip, mono), não modal genérico ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Tabela | `post_comments(id, postId→posts, memberId→members, body, createdAt)` | Espelha `likes`/`posts`; FK declara dono do comentário e do alvo |
| Contagem | subselect `(SELECT COUNT(*) FROM post_comments ...)` em `listPosts` | Mesmo pattern do `likeCount`; zero N+1 |
| XP | `XP.comment = 5` em `lib/game.ts` | Mesma casa dos demais valores; 5 = metade do post (conversa < conteúdo) |
| Ordenação | `ORDER BY createdAt ASC, id ASC` | Conversa se lê na ordem; id desempata mesmo segundo |
| UI | thread expansível sob o post + composer inline | Feed continua uma coluna; expandir é opt-in |
| Composer anon | oculto | Ler é público, escrever é de membro — mesmo contrato do composer de post |
| Auth no POST | `getMemberByClerkId` (não getOrCreate) | Comentar exige membro já provisionado — mesmo fluxo do like |

## Phase 1 — Design

### data-model.md

```sql
post_comments: id PK, postId → posts(id), memberId → members(id),
               body TEXT (1–1000 após trim), createdAt default datetime('now')
```

Nenhuma coluna nova em `posts`/`members` — `commentCount` é derivado.

### contracts/api.md

- `GET /api/posts/[id]/comments` → `{comments: Comment[]}` público, ASC; 404 post inexistente/id inválido
- `POST /api/posts/[id]/comments` → `{comment}` 201; body `{body: string}` 1–1000 após trim → 400; 401 deslogado/sem member; 404 post inexistente; +5 XP + `checkBadges`
- `GET /api/posts` → cada post ganha `commentCount: number`
- `Comment` = `{id, postId, body, createdAt, username, name, persona, xp}`

### Render

- `FeedSection`: botão `▸ {n} comentários` alterna pra `▾` e lazy-fetches a thread uma vez
- Comentário: `@username` (link `/u/[username]`) · chip LV · chip persona · timestamp — mesma hierarquia do autor do post
- Composer inline (input + "comentar →") só quando `canPost`; anon lê tudo e não vê caixa

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /api/posts/1/comments` → `{comments: []}` ou thread
3. Logado → comenta no feed → +5 XP e contagem sobe sem reload
