# Tasks: Desafios Patrocinados

**Feature**: `006-sponsored-challenges` | TDD: testes antes da implementação.

## Fase 1 — Schema + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/challenges.test.ts` — createChallenge valida sponsor/title, getChallenges retorna só ativos ordenados, updateChallenge faz patch parcial + desativa (some da lista pública), seeds Oracle presentes
- [x] T1.2 `lib/db.ts`: tabela `challenges` + seeds PUC (Oracle) e Unifacens (Oracle + Enterprise X Ventures)
- [x] T1.3 `lib/challenges.ts`: getChallenges, getChallenge, createChallenge, updateChallenge

## Fase 2 — API admin

- [x] T2.1 Teste falhando: `tests/api/challenges.test.ts` — POST 201/400/404, PATCH 200/400/404; `tests/api/challenges-guards.test.ts` — 403 não-admin; `tests/api/auth.test.ts` — 401 deslogado nas 2 rotas
- [x] T2.2 `app/api/admin/hackathons/[id]/challenges/route.ts` (POST) + `app/api/admin/challenges/[challengeId]/route.ts` (PATCH)

## Fase 3 — Render pública + admin

- [x] T3.1 Teste BDD falhando: `tests/e2e/challenges.spec.ts` — /h/[id] mostra sponsor+prêmio do seed; POST admin deslogado → 401
- [x] T3.2 `/h/[id]/page.tsx`: seção "desafios patrocinados" (sponsor em destaque, prêmio em lendário)
- [x] T3.3 `/admin`: bloco "desafios patrocinados" por edição + `components/ChallengeForm.tsx` (criar) + toggle ativo
- [x] T3.4 Landing `/`: linha "sua marca pode lançar um desafio" → edição real

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
