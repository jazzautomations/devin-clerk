# Tasks: Feed de Hackathons

**Input**: Design documents from `/specs/001-hackathon-feed/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

## Phase 1: Setup

- [x] T001 Criar `data/` e `lib/` na raiz do repo (estrutura do plan.md)

## Phase 2: Foundational

- [x] T002 Definir tipos `Hackathon` e `HackathonFormat` ("online" | "presencial" | "hibrido") em `lib/hackathons.ts` conforme data-model.md
- [x] T003 Criar `data/hackathons.ts` com 5+ eventos reais seedados (datas futuras ISO 8601, mix de formatos/tags, um com `registrationDeadline` passado)
- [x] T004 Implementar `getUpcomingHackathons(now)` em `lib/hackathons.ts`: filtra `active && startsAt > now`, ordena por `startsAt` crescente; e `getTags()` retornando união das tags

## Phase 3: User Story 1 — Membro descobre hackathons (P1)

Goal: dashboard logado mostra lista ordenada com todos os campos.

Independent test: login → `/dashboard` → ≥1 evento com nome/organizador/data/formato/local/deadline/tags → link abre em nova aba.

- [x] T005 [P] [US1] Criar `components/HackathonCard.tsx`: card hairline do design system mostrando nome, organizador, data formatada `Intl.DateTimeFormat("pt-BR")`, formato, local ("Online" se null), tags em mono, link `target="_blank" rel="noopener"`, badge "inscrições encerradas" quando `registrationDeadline < now`, "inscrições abertas" quando deadline null
- [x] T006 [P] [US1] Criar `app/api/hackathons/route.ts` com `GET` protegido: `await auth()`, deslogado → `Response.json({error:"Unauthorized"},{status:401})`, logado → `{hackathons}` via `getUpcomingHackathons()`
- [x] T007 [US1] Atualizar `app/dashboard/page.tsx`: renderizar feed via `HackathonCard` acima dos cards de roadmap; estado vazio "nenhum hackathon aberto no momento" quando lista vazia

## Phase 4: User Story 2 — Membro filtra o feed (P2)

Goal: filtros por formato e tag no client.

Independent test: eventos com formatos/tags mistos → filtrar "online" → só online aparece; filtro sem resultado → empty state + limpar filtros.

- [x] T008 [US2] Criar `components/HackathonFeed.tsx` (client component): recebe `hackathons` serializados do server, estado `format` + `tag`, botões de formato (todos/online/presencial/híbrido) e tags; filtra em memória; empty state do filtro com "limpar filtros"
- [x] T009 [US2] Trocar render direto do dashboard por `<HackathonFeed hackathons={...} tags={...}>` em `app/dashboard/page.tsx`

## Phase 5: User Story 3 — Admin cura o feed (P3)

Goal: cadastrar evento editando `data/hackathons.ts` aparece sem mudar UI.

Independent test: adicionar evento no seed → reload → aparece ordenado.

- [x] T010 [US3] Validar curadoria: inserir 1 evento novo no seed, confirmar ordenação e aparição (sem código novo — é o T003 + verificação)

## Phase 6: Polish

- [x] T011 Remover "Feed de hackathons" de `upcomingFeatures` em `app.config.ts`
- [x] T012 Rodar `PRODUCTION.md` seções 1–5: lint/typecheck/build, curls (`/` 200, `/dashboard` redirect, `/api/hackathons` 401, `/api/roadmap` 401), 390px sem scroll X
- [x] T013 Commit + push pro fork

## Dependencies

US1 (T005–T007) → US2 (T008–T009) → US3 (T010). Setup/foundational antes de tudo. US3 não adiciona código — só verificação.

## Parallel opportunities

T005 e T006 em paralelo (arquivos diferentes). Seed (T003) e tipos (T002) podem ser escritos juntos.

## MVP scope

US1 sozinha já entrega o produto: feed real no dashboard. US2/US3 são incrementos da mesma sessão.
