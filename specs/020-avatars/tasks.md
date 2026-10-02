# Tasks: Avatares

**Feature**: `020-avatars` | TDD: testes antes da implementação.

## Fase 1 — Schema + sync (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/avatars.test.ts` — grava no create, atualiza quando imageUrl muda, preserva quando nulo, `initialsFor` cobre os 3 caminhos
- [x] T1.2 `lib/members.ts`: migração `avatarUrl` top-level + `Member.avatarUrl` + sync em `getOrCreateMember` (INSERT e UPDATE condicional)
- [x] T1.3 Todos os call sites de `getOrCreateMember` repassam `user.imageUrl` (dashboard, feed, radar, perfil, admin, api/posts)

## Fase 2 — JOINs

- [x] T2.1 Testes falhando: `listPosts`/`listComments`/`getRegistrationsByHackathon`/`listTalent` retornam `avatarUrl`
- [x] T2.2 `lib/posts.ts`, `lib/comments.ts`, `lib/registrations.ts`, `lib/talent.ts`: selects + tipos

## Fase 3 — Componente + UI

- [x] T3.1 `components/Avatar.tsx`: img ou bloco de iniciais, sm/md/lg
- [x] T3.2 `FeedSection`: avatar em post (sm) e comentário (sm); tipos `FeedPost`/`FeedComment`
- [x] T3.3 Páginas: `/u/[username]` (lg), `/membros` (md), `/talento` (md), `/dashboard` saudação (md), `/h/[id]` inscritos (sm)

## Fase 4 — BDD + Gate

- [x] T4.1 `tests/e2e/avatars.spec.ts`: post de membro com avatar renderiza `<img>`; sem avatar renderiza iniciais; perfil público mostra avatar
- [x] T4.2 lint + typecheck + build + test + test:e2e verdes
