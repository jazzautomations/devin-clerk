# Implementation Plan: Busca + OG dinâmico

**Branch**: `023-search-og` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

`?q=` server-side nas três listas públicas (radar/membros/projetos) com
`<form method="get">` mínimo e inputs hidden pros filtros ativos. LIKE
escapado (`%`, `_`) em members/projects; radar filtra em JS sobre a lista
upcoming. OG dinâmico por edição em `app/h/[id]/opengraph-image.tsx` —
mesmo padrão do `app/opengraph-image.tsx`, borda no hex da raridade da
carta; `/p/[teamId]` idem (título + edição + colocação). TDD: unit de
busca/escape falhando antes de implementar, e2e de `?q=` + png depois.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — sem schema novo, só leitura
- **Testing**: Vitest (unit dos libs) + Playwright (BDD público + fetch do OG)
- **OG**: `ImageResponse` de `next/og`, params async (`Promise<{id}>`), runtime node default (sqlite ok)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅
- II. Community-first: busca e OG são públicos e gratuitos ✅
- III. Auth: nada de escrita — tudo GET público ✅
- IV. One-session scope: 3 libs + 3 páginas + 2 rotas de imagem ✅
- V. No slop UI: form mono mínimo, empty states honestos ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde filtrar radar | `searchHackathons(q, now)` em `lib/hackathons.ts` — JS `includes` sobre name/location/tags após `getUpcomingHackathons` | Lista já é materializada em JS (tags são JSON); SQL LIKE em coluna JSON ia mentir |
| Onde filtrar membros/projetos | `q?` opcional em `listLeaderboard(sort,limit,q)` e `listProjects({q})` — `LIKE @q ESCAPE '\'` | Colunas reais; SQLite LIKE já é case-insensitive p/ ASCII |
| Escape LIKE | helper `likePattern(q)` → `%…%` com `\\`/`%`/`_` prefixados por `\` | Sem escape, `%` do usuário vira coringa (FR-005) |
| Preservar filtros | inputs hidden no form + `q` embutido nos hrefs dos chips | GET reseta params não renderizados |
| OG edição | `opengraph-image.tsx` dentro de `app/h/[id]/`, `getHackathon` + `getCardRarity`, hex inline | ImageResponse não lê CSS vars — hex direto; fallback p/ id ruim = imagem da marca |
| OG projeto | `app/p/[teamId]/opengraph-image.tsx` com `getProjectByTeamId` | Trivial — mesma shape, placement badge |

## Phase 1 — Design

### contracts

- `searchHackathons(q: string, now?: Date): Hackathon[]` — upcoming filtrado; q vazio = upcoming inteiro
- `listLeaderboard(sort?, limit?, q?): Member[]` — LIKE em username/name/headline/skills
- `listProjects({hackathonId?, liveOnly?, q?}): ProjectCard[]` — LIKE em tp.title/tp.description/t.name
- `GET /h/[id]/opengraph-image` → `image/png` 1200×630 (200 sempre; fallback p/ id ruim)
- `GET /p/[teamId]/opengraph-image` → `image/png` 1200×630 (idem)

### quickstart.md

1. `npm run test` e `npm run test:e2e` verdes
2. `/radar?q=alphaville` só mostra Alphaville; `?q=zzz` → empty state
3. `curl -I /h/hack-inova-unifacens-2026/opengraph-image` → 200 image/png
