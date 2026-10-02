# Implementation Plan: Leaderboard de Membros

**Branch**: `007-leaderboard` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

`/membros` deixa de ser diretório em grid e vira ranking público:
`listLeaderboard(sort)` novo em `lib/members.ts` (ORDER BY xp DESC,
username ASC; `recent` → createdAt DESC, id DESC) com contagens de
badges/campanhas/cartinhas em subselects. Página server component com
`searchParams` awaited, `<ol>` numerada, pódio nos tokens de raridade
(#1 lendário, #2 épico, #3 raro) e `XpBar` por linha. TDD: testes de
ordenação/contagens falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` (zero migração — `members.xp` já existe)
- **Testing**: Vitest (unit da lib, db `:memory:`) + Playwright (BDD público)
- **Padrão de dados**: `listLeaderboard` novo em `lib/members.ts` — mesmo estilo de `listMembers` (subselects de contagem)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: ranking é público e gratuito ✅
- III. Auth: nenhuma escrita nova; página pública ✅
- IV. One-session scope: lib + página + testes em uma sessão ✅
- V. No slop UI: pódio com hierarquia real (lendário > épico > raro), não lista genérica ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Ordenação | `ORDER BY m.xp DESC, m.username ASC` no SQL | Determinística, barata; xp já indexado por coluna |
| Desempate | `username ASC` | Estável e alfabético — reload nunca embaralha |
| Pódio | tokens `lendario`/`epico`/`raro` existentes | Hierarquia de raridade já comunica valor; nada de CSS novo |
| Contagens | subselects `member_badges`/`registrations`/`member_cards` | Mesmo pattern de `listMembers`; N+1 evitado |
| `?sort=recent` | `searchParams` awaited (Next 16) → `createdAt DESC, id DESC` | Página já vira dinâmica, o que é correto pra ranking vivo |
| Pódio no modo recent | suprimido | Ordem cronológica não é mérito — sem ouro pra quem só entrou |
| `listMembers` | mantido | `app/page.tsx` usa pra contagem de membros na landing |

## Phase 1 — Design

### data-model.md

Nenhuma migração. Leitura sobre tabelas existentes:

```sql
members.xp           → ranking + LV (derivado via levelFor)
member_badges        → COUNT(*) badges
registrations        → COUNT(*) campanhas
member_cards         → COUNT(*) cartinhas
```

### contracts/api.md

Sem API nova — leitura embutida no render de `/membros`.

- `listLeaderboard(sort: "xp" | "recent" = "xp", limit = 100): Member[]`
  - `xp`: `ORDER BY xp DESC, username ASC`
  - `recent`: `ORDER BY createdAt DESC, id DESC`
  - `Member` ganha `badges?: number`
- `/membros?sort=recent` — único query param; qualquer outro valor → `xp`

### Render

- `<ol>` com `<li data-rank={n}>`; rank `#n` em mono
- #1: `border-lendario/60 bg-lendario/5` + rank `text-lendario`
- #2: `border-epico/40` + rank `text-epico`; #3: `border-raro/40` + rank `text-raro`
- Linha: rank · nome/@username (+persona) · headline · `{n} badges · {n} camp. · {n} cards` · `XpBar`

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /membros` → `<ol>` com `data-rank="1"` carregando classe `lendario`
3. `/membros?sort=recent` reordena sem cores de pódio
