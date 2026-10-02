# Implementation Plan: Avatares

**Branch**: `020-avatars` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

`members.avatarUrl TEXT` via migração idempotente no topo de `lib/members.ts`
(`lib/db.ts` congelado — trabalho paralelo). `getOrCreateMember` passa a aceitar
`imageUrl` do usuário Clerk: grava no INSERT e faz UPDATE condicional quando
presente e diferente. Componente `Avatar` (img ou iniciais) plugado no feed,
comentários, `/u/[username]`, `/membros`, `/talento`, `/dashboard` e inscritos
de `/h/[id]`. TDD: testes de sync/join falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite — migração em `lib/members.ts` (pattern `memberCols`)
- **Auth**: Clerk `user.imageUrl` — já vem no `currentUser()` das páginas
- **Testing**: Vitest (sync + joins) + Playwright (img vs fallback público)
- **Imagem**: `<img>` simples — `next/image` exigiria `remotePatterns` novo

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: avatar é público e gratuito ✅
- III. Auth: sync só onde o usuário Clerk já é buscado; escrita nenhuma nova ✅
- IV. One-session scope: coluna + sync + componente + joins em uma sessão ✅
- V. No slop UI: fallback de iniciais desenhado, não div cinza genérico ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde migrar | `lib/members.ts` top-level | `lib/db.ts` tem churn paralelo; mesmo pattern PRAGMA+ALTER |
| Onde sincronizar | `getOrCreateMember` | Único ponto onde o usuário Clerk materializa a linha; rodado por toda página autenticada |
| Semântica do sync | `imageUrl` truthy e diferente → UPDATE; falsy → preserva | Leitura nunca destrói dado gravado |
| Imagem | `<img>` plain, `data-avatar` | Zero config; Clerk só emite https; fallback por construção |
| Fallback | iniciais de `name` (2 palavras) ou `username` | Bloco mono com borda de acento — identidade visual consistente |
| PATCH /members/me | NÃO aceita avatarUrl | Fonte de verdade é o Clerk; campo editável criaria divergência |

## Phase 1 — Design

### data-model.md

- `members.avatarUrl TEXT` — nullable, gravado no INSERT e atualizado no
  UPDATE condicional do `getOrCreateMember`

### Contratos de leitura (JOINs)

- `listPosts`/`createPost` select: `+ m.avatarUrl` → `Post.avatarUrl`
- `listComments`/`createComment` select: `+ m.avatarUrl` → `Comment.avatarUrl`
- `getRegistrationsByHackathon`: `+ m.avatarUrl` no retorno tipado
- `listTalent`: `+ m.avatarUrl` no select e em `TalentEntry`
- `listLeaderboard`/`listMembers`/`getMemberByUsername`/`getMemberByClerkId`:
  `m.*`/`SELECT *` — automático uma vez que a coluna existe

### Componente

`components/Avatar.tsx` — `{ username, name?, avatarUrl?, size?: "sm"|"md"|"lg" }`:
- `avatarUrl` truthy → `<img>` quadrado arredondado, `border-line`, `object-cover`
- senão → `<span>` com iniciais, `font-mono`, borda/fundo de acento
- `initialsFor(name, username)` exportado pra teste unitário

## Phase 2 — Tasks

Ver [tasks.md](./tasks.md).
