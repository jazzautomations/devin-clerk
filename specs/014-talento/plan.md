# Implementation Plan: Talento — diretório de quem entrega

**Branch**: `014-talento` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

## Summary

Coluna `openTo` em `members` (opt-in comercial: trampo/cofundador/freela/mentoria)
via migração idempotente própria em `lib/talent.ts` — `lib/db.ts` intacto por
causa de trabalho paralelo. `PATCH /api/members/me` valida a whitelist e grava;
`/perfil` ganha seletor multi-chip; `/talento` é a vitrine pública ordenada por
XP com prova de entrega do arquivo. TDD: unit + API + e2e falhando antes.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — ALTER idempotente em `lib/talent.ts`
  (mesmo pattern do bloco `memberCols` ao fim de `lib/db.ts`)
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (BDD público;
  seed via `data/hackahub.db` como em `tests/e2e/comments.spec.ts`)
- **Padrão de dados**: `lib/talent.ts` novo — mesmo estilo de `lib/archive.ts`;
  constante whitelist em módulo puro `lib/openTo.ts` (sem db, importável por
  client components como `lib/game.ts`)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: participante nunca paga; `openTo` é opt-in consentido ✅
- III. Auth: escrita só via `PATCH /api/members/me` autenticado (401 deslogado) ✅
- IV. One-session scope: coluna + PATCH + página pública em uma sessão ✅
- V. No slop UI: prova real do arquivo (projetos + pódio), não lista genérica ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde vive a coluna | `openTo TEXT` em `members`, ALTER em `lib/talent.ts` | Schema principal está sob trabalho paralelo; migração idempotente própria não colide |
| Formato | CSV (`"trampo,freela"`), não JSON | Segue o estilo do pedido; whitelist fecha o conjunto, parse é trivial |
| Whitelist | `OPEN_TO` em `lib/openTo.ts` (módulo puro) | `ProfileForm` é client component — não pode importar `lib/talent.ts` (puxa better-sqlite3); constante pura resolve os dois lados |
| Projetos/melhor colocação | Reusa `getMemberProjects(username)` de `lib/archive.ts` | Zero duplicação de join; placement>0 ordenado = pódio já resolvido |
| Leitura pública | Server component chama `listTalent()` direto | Sem API nova — mesmo padrão de `/membros` |
| Empty→opt-out | `openTo: []` grava NULL | NULL e `""` tratados igual; NULL é o estado limpo |

## Phase 1 — Design

### data-model.md

```sql
-- ALTER TABLE idempotente, executado no import de lib/talent.ts:
members.openTo TEXT NULL   -- 'trampo[,cofundador][,freela][,mentoria]'
```

### contracts/api.md

- `PATCH /api/members/me` — body estendido com `openTo?: string[]`.
  - `openTo` presente e não-array / não-string / fora da whitelist → **400**
  - `openTo: []` → grava NULL (sai do diretório)
  - ausente → coluna preservada (patch parcial)
  - 401 deslogado (inalterado)
- Sem `GET /api/talento` — leitura embutida no render de `/talento`.

### lib/talent.ts

```ts
setOpenTo(memberId: number, values: string[]): string[]  // throw em inválido
getOpenTo(memberId: number): string[]
listTalent(limit = 100): TalentEntry[]                   // xp desc, opt-in only
// TalentEntry: { memberId, username, name, headline, persona, skills, github,
//   xp, openTo[], projects, best: {placement, hackathonId, hackathonName}|null }
```

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl localhost:3000/talento` → 200 com `// talento`
3. PATCH `openTo:["trampo"]` no próprio perfil → aparece em `/talento`
