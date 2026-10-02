# Implementation Plan: Submissão de Time pelo Membro

**Branch**: `021-team-submission` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

## Summary

O inscrito submete o próprio time+projeto na edição — o arquivo (003)
passa a se auto-preencher. `lib/teams.ts` novo com `memberTeamFor`,
`submitTeam` (placement sempre 0, colegas só se inscritos) e
`updateTeamProject` (só integrante). Rota `/api/hackathons/[id]/team`
(GET/POST/PATCH) + seção "meu time" em `/h/[id]` via `MyTeamPanel`.
XP `teamSubmit` (+15). TDD: testes unit/API/e2e falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — NÃO edita (tabelas de 003 já existem)
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (anon + guards)
- **Padrão de dados**: `lib/teams.ts` novo — mesmo estilo de `lib/teamboard.ts`/`lib/archive.ts`
- **Erros de domínio**: `TeamError { status }` — a rota mapeia pra 400/403/404/409 sem parsear mensagem

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: self-service gratuito, sem depender de admin ✅
- III. Auth: escrita autenticada + gate de inscrição; leitura da página continua pública ✅
- IV. One-session scope: lib + rota + painel em uma sessão ✅
- V. No slop UI: seção "meu time" contextual, não CRUD genérico ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde mora a lógica | `lib/teams.ts` novo | `lib/archive.ts` é leitura/cadastro admin; submissão tem regras próprias (inscrição, conflito, autor) — arquivo separado evita diff num lib compartilhado |
| placement | sempre 0, input ignorado | pódio é condecoração do organizador — auto-atribuição corromperia o arquivo |
| Colegas | só inscritos na edição E sem time; resto → `ignoredUsernames` | alinhado ao gate do board; um membro = um time por edição mantém `memberTeamFor` único |
| Projeto no PATCH | upsert (`INSERT … ON CONFLICT(teamId)`) | time pode nascer sem projeto e receber depois — mesma rota de edição |
| PATCH identifica time por | `teamId` no body + match com `hackathonId` | 404/403 explícitos e testáveis; cliente sempre tem o id (GET/página) |
| XP | `teamSubmit: 15` em `lib/game.ts` | criar time vale mais que anúncio (10), menos que inscrição (50) |

## Phase 1 — Design

### data-model.md

Sem schema novo — reusa `teams`, `team_members`, `team_projects`,
`registrations`, `members`. Invariantes novas garantidas pela lib:

- UNIQUE (hackathonId, name) já existe → conflito vira 409
- um membro = um time por edição → checado antes do INSERT (autor e colegas)

### contracts/api.md

`app/api/hackathons/[id]/team/route.ts`:

- `GET` — auth 401 → edição ativa 404 → membro 401 → `memberTeamFor` →
  200 `{team}` ou 404 `{error}`.
- `POST` — auth 401 → edição ativa 404 → membro 401 → inscrito senão
  403 `{error: "inscreve-te primeiro"}` → body `{name, memberUsernames?,
  project?{title,description?,repoUrl?,demoUrl?}}` → `submitTeam` →
  201 `{team, ignoredUsernames, xp: "+15", newBadges}`;
  `TeamError.status` mapeia 400/409.
- `PATCH` — auth 401 → edição 404 → membro 401 → body `{teamId, title?,
  description?, repoUrl?, demoUrl?}` → `updateTeamProject` →
  200 `{team}`; 404 time inexistente/outra edição; 403 não-integrante;
  400 patch inválido.

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. Inscrito: `POST /api/hackathons/hack-inova-alphaville-2026/team` → 201;
   `curl /h/…` mostra o time na lista de participantes e `/p/[teamId]` no ar
3. `PATCH` com `repoUrl` novo → ficha pública reflete na hora
