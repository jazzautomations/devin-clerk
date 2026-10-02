# Tasks: Sponsors — CRM de marcas

**Feature**: `019-sponsors` | TDD: testes antes da implementação.

## Fase 1 — lib sponsors + vínculo em challenges (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/sponsors.test.ts` — createSponsor (defaults, name único, tier válido), updateSponsor (patch parcial, active, null limpa), listSponsors com challengeCount, createChallenge com sponsorId (valida + copia nome), getChallenges expõe sponsorUrl/sponsorTier via join, fallback texto, getSponsorForChallenge
- [x] T1.2 `lib/sponsors.ts`: schema idempotente (CREATE TABLE + ALTER challenges) + CRUD
- [x] T1.3 `lib/challenges.ts`: LEFT JOIN + `sponsorId` em createChallenge/updateChallenge

## Fase 2 — API admin

- [x] T2.1 Testes falhando: `tests/api/sponsors.test.ts` — POST 201/400 (name/tier/dup), GET 200, PATCH 200/404/400, challenges POST com sponsorId 201/400; `tests/api/sponsors-guards.test.ts` — 403 não-admin; `tests/api/auth.test.ts` — 401 deslogado nas 3 rotas
- [x] T2.2 `app/api/admin/sponsors/route.ts` (POST+GET) + `app/api/admin/sponsors/[id]/route.ts` (PATCH)
- [x] T2.3 `sponsorId` em `app/api/admin/hackathons/[id]/challenges/route.ts` e `app/api/admin/challenges/[challengeId]/route.ts`

## Fase 3 — Render pública + admin

- [x] T3.1 Teste BDD falhando: `tests/e2e/sponsors.spec.ts` — /h/[id] mostra nome como link + chip tier do sponsor vinculado (seed via db); APIs admin 401 anon
- [x] T3.2 `/h/[id]/page.tsx`: sponsor como link (quando url) + chip de tier (master=lendário, sponsor=acento, apoio=muted)
- [x] T3.3 `/admin`: seção "// sponsors" + `components/SponsorForm.tsx` (criar) + toggle ativo

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
