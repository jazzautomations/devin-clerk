# Implementation Plan: "Procuro time" (formação de equipe por edição)

**Branch**: `012-team-finder` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Cada edição ganha um board público de "procuro time": tabela
`looking_for_team` (schema próprio idempotente em `lib/teamboard.ts` —
não edita `lib/db.ts`, mesmo pattern de `lib/deploys.ts`), API
`/api/hackathons/[id]/team-board` (GET público, POST autenticado com
gate de inscrição + upsert + +10 XP uma vez, DELETE desativa, PATCH
admin modera), e `TeamBoardPanel` client component na página `/h/[id]`.
TDD: testes de lib/API/e2e falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts`; tabela criada por `db.exec(CREATE
  TABLE IF NOT EXISTS)` no topo de `lib/teamboard.ts` (mesmo pattern de
  `lib/deploys.ts` — `lib/db.ts` não é tocada)
- **Testing**: Vitest (unit + API, Clerk mockado, db `:memory:`) +
  Playwright (BDD público; e2e seeda direto no `data/hackahub.db`)
- **Padrão de dados**: `lib/teamboard.ts` novo — mesmo estilo de
  `lib/comments.ts` (join members, select compartilhado)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: leitura pública, escrita gratuita pra inscritos ✅
- III. Auth: escrita só via API autenticada, 401 JSON deslogado ✅
- IV. One-session scope: tabela + lib + API + UI + testes em uma sessão ✅
- V. No slop UI: board com mesma linguagem do feed (persona chip, LV,
  mono), composer inline do inscrito ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Schema | `lib/teamboard.ts` com `db.exec` próprio | Outra feature paralela pode editar `lib/db.ts`; deploys.ts já prova o pattern |
| Unicidade | `UNIQUE(memberId, hackathonId)` + `INSERT OR IGNORE`→`UPDATE` | Upsert natural; `changes` do insert diz se foi a 1ª vez (gate do XP) |
| Gate de POST | exige linha em `registrations` | FR-002 — sem inscrição o board vira spam; 403 "inscreve-te primeiro" |
| Edição passada | esconde composer, lista continua | Times formados ficam visíveis no arquivo (spec edge case) |
| Auto-expirar | filtro `active = 1` na query | FR-007 — dados históricos ficam; UI só mostra composer em edição não-past |
| Moderação | `PATCH` na mesma rota gated a admin + toggle mínimo no `/admin` | FR-008 sem rota nova; espelha `ChallengeToggle` |
| XP | `XP.teamBoard = 10` em `lib/game.ts` | Única linha tocada no arquivo; pago só no primeiro insert |

## Phase 1 — Design

### data-model.md

```sql
looking_for_team: id PK AUTOINCREMENT,
  memberId INTEGER NOT NULL REFERENCES members(id),
  hackathonId TEXT NOT NULL REFERENCES hackathons(id),
  skills TEXT NOT NULL DEFAULT '[]'  -- JSON array
  need TEXT NOT NULL,                 -- o que falta no time (1–200)
  note TEXT,                          -- opcional (≤300)
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (memberId, hackathonId)
INDEX idx_lft_hackathon ON looking_for_team(hackathonId, active)
```

### contracts/api.md — ver [contracts/api.md](./contracts/api.md)

- `GET` público → `{entries[]}` (ativos, `createdAt ASC, id ASC`, join members)
- `POST` → 201 primeiro anúncio (+10 XP, checkBadges) / 200 re-anúncio (update + reativa); guards 401 → 404 → 403 → 400
- `DELETE` → desativa o próprio anúncio, idempotente 200
- `PATCH` (admin) → `{entryId, active}` modera qualquer anúncio da edição

### Render

- `/h/[id]`: nova seção `// quem tá procurando time` antes de "inscritos";
  aparece pra edição não-past sempre, e pra past só se houver entries
  (histórico). Contagem também entra no heading de inscritos.
- `TeamBoardPanel` (client): lista pública via `initialEntries`; inscrito
  (`canPost`) vê toggle "procuro time" + form (skills, need, note) ou o
  próprio anúncio com "desativar"/"editar".
- `/admin`: `<details>` por edição lista anúncios com `TeamBoardToggle`
  (desativar/reativar via PATCH).

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /api/hackathons/hack-inova-alphaville-2026/team-board` → `{entries: []}` ou board
3. Inscrito → "procuro time" → entry aparece no board com +10 XP
