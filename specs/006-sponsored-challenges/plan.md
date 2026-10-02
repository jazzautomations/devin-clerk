# Implementation Plan: Desafios Patrocinados

**Branch**: `006-sponsored-challenges` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Cada edição ganha `challenges` patrocinados: `sponsor` (marca que paga — o
inventário vendido), `title`, `description`, `prize`, `active`. Seeds cobrem os
dois casos reais (Oracle na PUC Saúde; Oracle + Enterprise X Ventures na
Unifacens). Admin ganha POST/PATCH + formulário. `/h/[id]` renderiza a seção;
landing ganha uma linha comercial. TDD: testes de lib/API/BDD falhando antes.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` (CREATE TABLE IF NOT EXISTS + seeds `INSERT OR IGNORE`, pattern existente)
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (BDD público)
- **Padrão de dados**: `lib/challenges.ts` novo — mesmo estilo de `lib/archive.ts`/`lib/admin.ts`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: participante nunca paga — desafio é conteúdo público ✅
- III. Auth: escrita só via `/api/admin/*` com role check ✅
- IV. One-session scope: schema + seeds + API + render + form em uma sessão ✅
- V. No slop UI: sponsor com hierarquia real (a marca É o produto), prêmio em acento lendário ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Entidade sponsor | `challenges.sponsor` TEXT livre | "Oracle + Enterprise X Ventures" é texto; entidade `sponsors` (logo, contrato) é fase 2 |
| PK do desafio | `id` TEXT (uuid no insert, slug fixo no seed) | Desafio é recurso próprio endereçável no PATCH; TEXT evita colisão com seeds |
| Prêmio | `prize` TEXT livre | "R$5k + créditos OCI" não cabe em catálogo; destaque visual resolve a motivação |
| Desativar | `active` INTEGER (soft-delete) | Registro histórico/contratual nunca é apagado |
| Leitura pública | `getChallenges(hackathonId)` direto no server component de `/h/[id]` | Sem API pública — mesma decisão do arquivo (spec 003) |
| Seeds | PUC: Oracle "Jornada do paciente" (créditos OCI + visita); Unifacens: "Oracle + Enterprise X Ventures" "IA aplicada à saúde" (R$5k consultoria + OCI) | Patrocínio real divulgado das duas edições |

## Phase 1 — Design

### data-model.md

```sql
challenges: id TEXT PK, hackathonId→hackathons, sponsor, title,
            description NULL, prize NULL, active INT default 1, createdAt
```

### contracts/api.md

- `POST /api/admin/hackathons/[id]/challenges` — `{sponsor, title, description?, prize?}` → 201; 401 deslogado; 403 não-admin; 404 edição inexistente; 400 sem sponsor/title.
- `PATCH /api/admin/challenges/[challengeId]` — `{sponsor?, title?, description?, prize?, active?}` → 200; 401/403/404; 400 body vazio ou campo inválido.
- Leitura pública embutida no render de `/h/[id]` (sem API pública nova).

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /h/hack-inova-puc-saude-2026` → contém "Oracle" + "créditos OCI"
3. Login admin → POST challenge → página pública reflete sem rebuild
