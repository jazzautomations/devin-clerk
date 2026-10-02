# Tasks: Rate Limiting

**Feature**: `031-rate-limit` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/ratelimit.test.ts` — janela desliza (expira o mais antigo), isolamento por chave, retryAfter ≈ expiração do hit mais antigo, cleanup do Map (varredura), clientIp (xff→x-real-ip→anon), limitOrNull (null ok / 429+Retry-After)
- [x] T1.2 `lib/ratelimit.ts`: `rateLimit`, `clientIp`, `limitOrNull`, `RATE_LIMITS`, `resetRateLimits`/`rateLimitSize` (só testes)

## Fase 2 — Rotas

- [x] T2.1 Teste falhando: `tests/api/ratelimit.test.ts` — /api/leads 6ª chamada do mesmo IP → 429 JSON + Retry-After; IP distinto passa; register membro-keyed 11º → 429 e outro membro livre
- [x] T2.2 Inserts mínimos: `app/api/leads/route.ts`, `app/api/submissions/route.ts` (topo, por IP); `app/api/posts/route.ts`, `app/api/posts/[id]/comments/route.ts`, `app/api/posts/[id]/like/route.ts`, `app/api/projects/[teamId]/vote/route.ts`, `app/api/hackathons/[id]/register/route.ts`, `app/api/hackathons/[id]/team/route.ts`, `app/api/hackathons/[id]/team-board/route.ts` (após member, por member.id)
- [x] T2.3 Ajustes de suíte: `tests/api/leads.test.ts` e `tests/api/submissions.test.ts` passam xff único por request; `tests/api/team.test.ts` chama `resetRateLimits()` no beforeEach (12+ POSTs do mesmo membro passariam do teto de 10/h)

## Fase 3 — E2E

- [x] T3.1 `tests/e2e/rate-limit.spec.ts` — spam `POST /api/leads` com IP único por run → 6º recebe 429 + `Retry-After`
- [x] T3.2 `tests/e2e/empresas.spec.ts` e `tests/e2e/submissions.spec.ts` ganham `x-forwarded-for` único (por request/page.route) — senão dividem o bucket `anon` e o próprio spam do e2e os derruba

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
