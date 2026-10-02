# Implementation Plan: Mural da Edição

**Branch**: `028-edition-feed` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

## Summary

Post ganha escopo opcional de edição (`posts.hackathonId`, NULL = global).
`lib/posts.ts` recebe o `ALTER` guardado (padrão do próprio arquivo —
`lib/db.ts` intocado), `listPosts` ganha `scope` (`{hackathonId}` |
`{global: true}` | omitido = agregado) e `createPost` aceita o 4º arg.
`GET /api/posts?h=` filtra por edição; `POST` valida edição (404/400) e
inscrição (403). `FeedSection` aceita `hackathonId`/`editionLabel` sem
quebrar `/feed`/`/dashboard`; `/h/[id]` ganha "// mural da edição" em diff
append-only; card com escopo mostra chip `→ edição`. TDD: testes
unit/API/e2e falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — NÃO edita; migração vive em `lib/posts.ts`
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (anon + guards)
- **Padrão de dados**: coluna nullable + guarded ALTER — mesmo pattern do
  `avatarUrl` em `lib/posts.ts`/`lib/registrations.ts`
- **Shared file**: `app/h/[id]/page.tsx` estável desde o ciclo 5 — append-only

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: mural é do inscrito; leitura pública vira vitrine ✅
- III. Auth: escrita autenticada + gate de inscrição; leitura pública ✅
- IV. One-session scope: coluna + filtro + prop + seção em uma sessão ✅
- V. No slop UI: mural é recorte do feed existente, não chat paralelo ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Escopo no schema | `posts.hackathonId TEXT` nullable | NULL = global; migração é um ALTER, posts existentes não mudam de significado |
| `/feed` e posts de edição | agregado — feed mostra tudo, com chip | mural é recorte, não silo: o rio global é a vitrine e o chip é a porta de volta pra edição |
| Assinatura do filtro | `listPosts(limit, meId, scope?: {hackathonId} \| {global:true})` | duas formas explícitas + omitido = tudo; callers antigos compilam sem mudança |
| Gate de escrita no mural | inscrito na edição (403) | mesmo gate do board/team; "só membro" abriria mural pra drive-by de qualquer conta |
| Gate temporal do mural | nenhum — inscrito posta depois do encerramento | demo/retro saem nos dias seguintes; inscrição já é o contrato social |
| GET `?h=` inválido | 404 (`!h \|\| !h.active`) | mesmo gate do `team-board` GET; não vaza edição inativa |
| POST em edição inativa | 400 (existe) / 404 (não existe) | escrita tem resposta honesta — o cliente explicitamente pediu aquela edição |
| Validação de edição | na rota, não na lib | a lib não conhece HTTP; a rota mapeia exists→404, active→400, registered→403 |
| Chip | `→ <name>` link `/h/[id]`, fallback pro id | contexto no agregado + tráfego de volta; join `LEFT` nunca quebra post |
| UI no mural | FeedSection + props `hackathonId`/`editionLabel` | um componente só; sem prop = comportamento atual (zero risco em /feed e /dashboard) |

## Phase 1 — Design

### data-model.md

- `posts.hackathonId TEXT NULL REFERENCES hackathons(id)` — adicionada por
  `PRAGMA table_info(posts)` + `ALTER TABLE` no topo de `lib/posts.ts`.
- `Post`/`FeedPost` ganham `hackathonId: string | null` e
  `hackathonName: string | null` (via `LEFT JOIN hackathons`).
- Sem tabela nova; `likes`/`post_comments`/`registrations` intocados.

### contracts/api.md

`app/api/posts/route.ts`:

- `GET` — público. `?h=<id>` → edição `!h || !h.active` → 404 JSON; senão
  `{posts}` filtrados. Sem `?h=` → `{posts}` agregado (global + edições).
- `POST` — auth 401 → member → `body` válido (400 "Post vazio") →
  `hackathonId` presente: não-string → 400; edição inexistente → 404;
  inativa → 400 `{"error":"edição inativa"}`; não-inscrito → 403
  `"inscreve-te primeiro"` → `createPost(..., hackathonId)` → 201
  `{post}` + `XP.post` + `checkBadges` (inalterado).

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. `curl "localhost:3000/api/posts?h=hack-inova-alphaville-2026"` → só posts
   da edição; `?h=nope` → 404
3. `/h/hack-inova-alphaville-2026` mostra "// mural da edição"; post do
   mural aparece no `/feed` com chip `→ Hack Inova Alphaville`
