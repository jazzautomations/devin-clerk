# Implementation Plan: Radar mostra eventos em andamento

**Branch**: `027-radar-ongoing` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

A fronteira "aberto" do radar passa de `startsAt > now` para
`COALESCE(endsAt, registrationDeadline, startsAt) >= now` — evento
Devpost em andamento (janela já abriu, ainda não fechou) volta a ser
listado (+43 cards, 25 com prêmio, no banco atual). `lib/hackathons.ts`
ganha `isOver` e `getOpenHackathons` (renomeia o nome que mentia) e
`getPastHackathons` vira o complemento exato. `HackathonCard` marca
"em andamento · até {endsAt}". Scraper alinha `is_expired`/`sweep_expired`
à mesma COALESCE. Landing ganha "+N · 30d" honesto (createdAt/first_seen).
TDD: testes unit/API/e2e falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router + Python (scraper)
- **Storage**: SQLite via `lib/db.ts` — SEM tabela nova; migração
  idempotente adiciona `first_seen`/`last_seen` a `hackathons` (hoje só
  o `ensure_schema` do scraper as cria — app não pode depender disso)
- **Testing**: Vitest (unit, `:memory:`) + Playwright (anon) + asserts
  puros em `scripts/test_scrape_radar.py`
- **Padrão**: boundary pura `isOver(h, now)` — testável, mesmo estilo de
  `isRegistrationClosed`/`editionPhase`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: radar mais completo sem custo pro membro ✅
- III. Auth: nada novo autenticado — `/radar`/`/` continuam públicos ✅
- IV. One-session scope: lib + card + stats + scraper em uma sessão ✅
- V. No slop UI: "em andamento" é estado do dado, não badge decorativo ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| "Encerrado" | `COALESCE(endsAt, registrationDeadline, startsAt) < now` | endsAt = fim do evento/janela; deadline de inscrição é o melhor proxy quando falta endsAt; sem os dois, start passado é tudo que sabemos |
| Nome da função | `getOpenHackathons` (rename de `getUpcomingHackathons`) | "upcoming" mente quando inclui ongoing — caller de 001/026 atualizado junto |
| `getPastHackathons` | complemento exato (`isOver`) | ongoing sai do "arquivo" — edição rolando não é histórico |
| Ordenação | mantém `startsAt` asc | ongoing encabeça naturalmente; "acaba antes" é v2 |
| `first_seen` no app | migração idempotente em `lib/db.ts` | `:memory:` dos testes e DBs sem scrape precisam da coluna pro SQL de momentum |
| Momentum "eventos" | `first_seen >= now-30d AND active=1 AND ainda aberto` | "+N" sob "hackathons abertos" conta o que entrou E continua aberto — subconjunto do stat que decora |
| Momentum "arquivo" | nunca | não há timestamp de "entrou no arquivo" — honesto é omitir |
| Scraper | `is_expired`/`sweep_expired` mesma COALESCE | regra de expiração divergente apagaria o que o radar quer mostrar |
| `/h/[id]`, arena, admin | fora do escopo | `past` lá é startsAt-based por decisão de 016; diff mínimo |

## Phase 1 — Design

### data-model.md

Sem tabela nova. `hackathons` ganha `first_seen`/`last_seen` TEXT via o
bloco de migrações idempotentes de `lib/db.ts` (PRAGMA + ALTER, mesmo
pattern de `source`/`prize` e do `ensure_schema` do scraper). Sem
backfill no app: NULL = "não sabemos quando entrou" → fora do momentum;
o scraper já backfill’a quando roda.

### contracts/api.md

Sem rota nova. `GET /api/hackathons` passa a retornar a lista aberta
(mesmo shape). `/radar` e `/` sem mudança de contrato — só conteúdo.

### quickstart.md

1. `npm run test` + `npm run test:scrape` + `npm run test:e2e` verdes
2. Banco real: `/radar` passa de ~27 para ~70 cards; ongoing marca
   "em andamento · até …"
3. Landing: stats com "+N · 30d" onde há timestamp real
