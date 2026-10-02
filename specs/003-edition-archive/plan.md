# Implementation Plan: Arquivo de Edições

**Branch**: `003-edition-archive` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Cada edição vira arquivo público: `teams` + `team_projects` + `team_members`
(vínculo por username) + `edition_assets` (fotos/slides/materiais). Seed cobre
o pódio público da Unifacens. Admin ganha API de cadastro. TDD: testes de
schema/lib/API falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` (migração idempotente, pattern existente)
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (BDD público)
- **Padrão de dados**: `lib/archive.ts` novo — mesmo estilo de `lib/posts.ts`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: arquivo é público e gratuito ✅
- III. Auth: escrita só via `/api/admin/*` com role check ✅
- IV. One-session scope: seed + API + render pública em uma sessão ✅
- V. No slop UI: pódio com hierarquia real, não lista genérica ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Vínculo membro↔time | `team_members(teamId, username)` com FK lógica | Username é estável; membro sem conta ainda recebe nome textual — o username é o identificador público |
| Fotos | `edition_assets(type,url,caption)` — URLs externas | Storage próprio é decisão de infra (fase 2); URL já resolve o arquivo do César |
| Pódio | `placement` INT (1,2,3; 0=participante) | Ordenação e rendering trivial |
| Projeto | 1:1 com team (`team_projects.teamId` UNIQUE) | Hackathon = 1 projeto por time; mais projetos é edge case desnecessário |
| Seed | Unifacens: pódio real público (One Day Hospital 1º) | Dado real divulgado; resto via admin |

## Phase 1 — Design

### data-model.md

```sql
teams:        id, hackathonId→hackathons, name, placement, createdAt
team_members: teamId→teams, username TEXT (não FK — pode ser nome livre)
team_projects: teamId→teams UNIQUE, title, description, repoUrl, demoUrl
edition_assets: id, hackathonId→hackathons, type IN (foto,slide,material), url, caption
```

### contracts/api.md

- `POST /api/admin/hackathons/[id]/teams` — `{name, placement, memberUsernames[], project?{title,description,repoUrl,demoUrl}}` → 201; 401 deslogado; 403 não-admin; 404 edição inexistente. Retorna `ignoredUsernames[]` se algum não existe.
- `POST /api/admin/hackathons/[id]/assets` — `{type,url,caption?}` → 201; mesmas guards.
- Leitura pública embutida no render de `/h/[id]` (sem API pública nova).

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /h/hack-inova-unifacens-2026` → contém "resultado", pódio com One Day Hospital
3. Login admin → POST team → página pública reflete sem rebuild
