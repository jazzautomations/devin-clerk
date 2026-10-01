# Implementation Plan: Feed de Hackathons

**Branch**: `001-hackathon-feed` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-hackathon-feed/spec.md`

## Summary

Feed members-only de hackathons no `/dashboard`: lista ordenada por data com
filtros de formato/tag, links externos de inscrição, e estados de
deadline/vazio. Fonte de dados do MVP é um módulo TS seedado
(`data/hackathons.ts`) atrás de uma camada `lib/hackathons.ts` — trocável por
Postgres depois sem tocar na UI. Remove "Feed de hackathons" de
`upcomingFeatures` ao shipar.

## Technical Context

**Language/Version**: TypeScript, Next.js 16.3.5 App Router, React 19, Node 22

**Primary Dependencies**: Tailwind v4, `@clerk/nextjs` (auth já integrado)

**Storage**: módulo TS seedado em `data/` (MVP); interface isolada pra
migração futura a Postgres/Supabase

**Testing**: smoke manual via curl (auth 401, dashboard 200 logado) + lint/
typecheck/build — sem framework de teste no repo ainda

**Target Platform**: Web SSR (Vercel-style, dev via `npm run dev`)

**Project Type**: web application (App Router, server components + islands)

**Performance Goals**: dashboard <2s p95 local; lista ≤50 eventos sem
paginação

**Constraints**: feed members-only (proxy.ts); design system escuro existente;
PT-BR

**Scale/Scope**: 1 página modificada + 2 componentes + 1 data module + 1 API
opcional

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Veredito |
|---|---|
| I. Spec-driven increments | ✅ feature única, escopo de uma sessão |
| II. Community-first monetization | ✅ feed gratuito pra membros |
| III. Auth & data integrity | ✅ `/dashboard` já protegido via proxy.ts; nenhum segredo novo |
| IV. One-session scope | ✅ seed TS + UI; sem crawler nem admin UI |
| V. No slop UI | ✅ usa tokens do globals.css; cards hairline existentes |

Post-design: mesma avaliação — nenhuma violação, sem Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-hackathon-feed/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
data/
└── hackathons.ts        # seed editável — a "fonte de dados" do MVP

lib/
└── hackathons.ts        # getUpcomingHackathons(), getTags(), tipos

components/
├── HackathonCard.tsx    # item do feed (hairline card, design system)
└── HackathonFeed.tsx    # lista + filtros client-side (formato/tag)

app/
├── dashboard/page.tsx   # greeting + feed real + roadmap menor
└── api/hackathons/route.ts  # GET protegido (401 deslogado)
```

**Structure Decision**: Next.js App Router single project. Dados em `data/`,
acesso em `lib/`, UI em `components/`, rotas em `app/` — convenção já
existente do repo.

## Complexity Tracking

Nenhuma violação — seção intencionalmente vazia.
