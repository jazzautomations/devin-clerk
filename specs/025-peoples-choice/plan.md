# Implementation Plan: Escolha do Povo — voto da comunidade em projetos

**Branch**: `025-peoples-choice` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

## Summary

O `/projetos` (017) e a ficha `/p/[teamId]` (010) só mostram o pódio do júri.
Aqui entra o sinal da comunidade: `lib/votes.ts` novo com schema idempotente
(`votes` — PK `(memberId, teamId)`, um voto por membro por projeto), `toggleVote`
com gates de domínio (404 sem projeto, 403 no próprio time) e helpers de placar.
`POST /api/projects/[teamId]/vote` devolve `{voted, count}`. `listProjects`
ganha `voteCount`/`votedByMe`/`sort:"votes"`; `/projetos` mostra `▲ N` e o chip
"escolha do povo"; a ficha ganha `VoteButton` otimista. Sem XP — voto é sinal,
não moeda. TDD: testes unit/API/e2e falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — NÃO edita; `CREATE TABLE IF NOT EXISTS
  votes` no import de `lib/votes.ts` (pattern `lib/leads.ts`/`lib/deploys.ts`)
- **Testing**: Vitest (unit+API, Clerk mockado, `HACKAHUB_DB=:memory:`) +
  Playwright (anon: 401 JSON, placar público, chip de sort)
- **Erros de domínio**: `VoteError { status }` — a rota mapeia 403/404 sem
  parsear mensagem (pattern `TeamError` de 021)
- **Auth**: `await auth()` → `getMemberByClerkId` → sem member = 401 (mesmo
  gate do like em posts)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: votar é grátis e de membro; leitura do placar é pública ✅
- III. Auth: escrita autenticada com 401 JSON; leitura (`/projetos`, `/p`)
  continua pública ✅
- IV. One-session scope: uma lib + uma rota + um botão + duas páginas ✅
- V. No slop UI: ▲/△ mono (mesmo glifo do like do feed), `border-line`,
  acento só no estado votado ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Schema | `votes(memberId, teamId, createdAt, PK(memberId,teamId))` em `lib/votes.ts` | Pattern 008/022; `lib/db.ts` intocado; PK faz dedupe físico — retry nunca duplica |
| Toggle | `toggleVote` insere/remove e devolve `{voted}` | Um endpoint só; o cliente nunca precisa saber o estado anterior |
| Self-vote | 403 quando o `username` do membro está em `team_members` do time | Voto é sinal da comunidade, não autopromoção; mesma regra do Colosseum/TAIKAI (votação vale pros outros) |
| "Projeto votável" | linha em `team_projects` | Mesmo gate de `/p/[teamId]` e do índice — votar no que não tem ficha seria invisível |
| Placar no índice | subquery `COUNT(*)` + `EXISTS(... @me)` no `listProjects` | Uma query só; `votedByMe` segue o pattern `likedByMe` de `lib/posts.ts` |
| `sort=votes` | `ORDER BY voteCount DESC` + desempate placement/edição | Júri continua default; "escolha do povo" é chip, não ruptura |
| XP/badge | NENHUM | Voto farmável vira inflação (like já paga +5 pro autor — votos em projeto ficariam duplamente monetizados); sinal puro |
| UI do voto | só na ficha `/p/[teamId]` + contador nos cards | Índice mostra placar; clicar em card navega, não vota — evita toggle acidental |

## Phase 1 — Design

### data-model.md

```sql
votes: memberId INTEGER NOT NULL REFERENCES members(id),
       teamId  INTEGER NOT NULL,
       createdAt TEXT NOT NULL,            -- ISO via new Date().toISOString()
       PRIMARY KEY (memberId, teamId)
INDEX idx_votes_team ON votes(teamId)
```

Invariantes garantidas pela lib: votável ⇒ `team_projects` tem o `teamId`
(404); membro não vota no próprio time (403 via `team_members.username`).

### contracts/api.md

`app/api/projects/[teamId]/vote/route.ts`:

- `POST` — auth 401 (sem sessão ou sem member) → `teamId` inválido/time sem
  projeto 404 → integrante do time 403 `{error: "não dá pra votar no teu
  próprio time"}` → `toggleVote` → 200 `{voted, count}`.

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. Logado: `POST /api/projects/<teamId>/vote` → `{voted:true, count:1}`;
   repete → `{voted:false, count:0}`
3. `/projetos` mostra `▲ N` nos cards; `?sort=votes` ranqueia pelo povo;
   `/p/<teamId>` tem o botão ▲ otimista
