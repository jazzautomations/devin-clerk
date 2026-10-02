# Implementation Plan: Sponsors — CRM de marcas

**Branch**: `019-sponsors` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

`sponsors` vira entidade (id, name único, url, tier apoio/sponsor/master,
contactEmail, notes, active) em `lib/sponsors.ts` com schema idempotente no
próprio módulo — pattern de `lib/deploys.ts`, sem tocar o exec de `lib/db.ts`.
O mesmo módulo faz `ALTER TABLE challenges ADD COLUMN sponsorId` (PRAGMA
check). `lib/challenges.ts` ganha LEFT JOIN expondo `sponsorId`/`sponsorUrl`/
`sponsorTier` e aceita `sponsorId` em create/update (copiando o nome da
entidade pro `sponsor` TEXT quando o texto não vier). APIs admin:
POST/GET `/api/admin/sponsors`, PATCH `/api/admin/sponsors/[id]`. `/admin`
ganha seção "// sponsors" própria; `/h/[id]` renderiza nome como link + chip
de tier. TDD: testes falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — intacto; schema próprio no import de
  `lib/sponsors.ts` (pattern 008-deploys / 017-projects)
- **Testing**: Vitest (unit+API, Clerk mockado, `HACKAHUB_DB=:memory:`) +
  Playwright (BDD público com seed direto em `data/hackahub.db`)
- **Padrão de dados**: `lib/sponsors.ts` novo; `lib/challenges.ts` importa a
  lib (garante tabela+coluna no `:memory:`) e faz o JOIN

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: sponsors pagam, participante nunca; leitura pública ✅
- III. Auth: escrita só via `/api/admin/*` com role check (401/403) ✅
- IV. One-session scope: uma lib + duas rotas + wiring em uma sessão ✅
- V. No slop UI: tier com hierarquia real (master=lendário), fallback texto ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Schema | `lib/sponsors.ts` com `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE challenges` idempotente (PRAGMA) | Trabalho paralelo em `lib/db.ts`; pattern estabelecido do 008 |
| `sponsor` TEXT | Mantido NOT NULL — display/fallback; com `sponsorId` e sem texto, copia `sponsor.name` | Desafio legado e vínculo convivem; display nunca quebra |
| Leitura | LEFT JOIN `sponsors` em getChallenges/listChallenges/getChallenge → `sponsorUrl`/`sponsorTier` | Join na leitura (não cópia) — url/tier sempre frescos |
| Dependência | `lib/challenges.ts` importa `lib/sponsors.ts` (getSponsor) | Garante tabela+coluna em `:memory:` e em rotas que só importam challenges; sem ciclo (sponsors só importa db) |
| sponsorId inválido | 400 no POST/PATCH de desafio (validação de body) | Id inexistente é erro de input, não de recurso |
| Desativar sponsor | `active=0`; vínculos continuam renderizando | Contrato encerrado ≠ histórico apagado |
| Picker sponsor↔desafio | Só via API (`sponsorId` no POST/PATCH) | `/admin` ganha CRUD de sponsors; picker no ChallengeForm fica pra próxima iteração |

## Phase 1 — Design

### data-model.md

```sql
sponsors: id TEXT PK, name TEXT UNIQUE NOT NULL, url TEXT,
  tier TEXT CHECK IN ('apoio','sponsor','master') DEFAULT 'sponsor',
  contactEmail TEXT, notes TEXT, active INT DEFAULT 1, createdAt

challenges: + sponsorId TEXT NULL  (ALTER idempotente; sem REFERENCES —
  FK lógica resolvida no join; sponsor desativado não desvincula)
```

`listSponsors()` → `Sponsor & { challengeCount }` — COUNT via subquery em
`challenges.sponsorId`. `getSponsorForChallenge(challengeId)` → join direto.

### API

- `POST /api/admin/sponsors` — `{name, url?, tier?, contactEmail?, notes?}` → 201; 401/403; 400 name vazio/duplicado/tier inválido
- `GET /api/admin/sponsors` — `{sponsors[]}` com `challengeCount`; 401/403
- `PATCH /api/admin/sponsors/[id]` — patch parcial → 200; 404/400
- `POST /api/admin/hackathons/[id]/challenges` — aceita `sponsorId`; exige `sponsor` ou `sponsorId` (+ `title`)
- `PATCH /api/admin/challenges/[challengeId]` — aceita `sponsorId` (string | null)

### Render

`/h/[id]`: linha do sponsor vira `{c.sponsorUrl ? <a href>…</a> : c.sponsor}`
+ chip `TIER_CLASS[c.sponsorTier]` (master → lendário, sponsor → acento,
apoio → muted). `/admin`: seção "// sponsors" entre edições e o grid
newsletter/membros — lista + `SponsorForm` + `SponsorToggle`
(estilo `ChallengeForm`/`ChallengeToggle`).
