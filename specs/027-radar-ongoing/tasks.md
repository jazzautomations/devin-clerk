# Tasks: Radar mostra eventos em andamento

**Feature**: `027-radar-ongoing` | TDD: testes antes da implementação.

## Fase 1 — Fronteira "aberto" (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/radar-ongoing.test.ts` — isOver (endsAt futuro/passado, fallback deadline, fallback startsAt, fronteira `==` now); getOpenHackathons inclui ongoing e futuro, exclui encerrado, ordena startsAt asc; getPastHackathons = complemento; searchHackathons sobre abertos
- [x] T1.2 `lib/hackathons.ts`: `isOver`, `getOpenHackathons` (rename), `getPastHackathons` por `isOver`, `searchHackathons`/`getTags` sobre a lista aberta
- [x] T1.3 Callers: `app/radar/page.tsx`, `app/page.tsx`, `app/dashboard/page.tsx`, `app/api/hackathons/route.ts`, `lib/seo.ts`, `tests/unit/prize.test.ts`, comentário em `tests/unit/search.test.ts`

## Fase 2 — Card "em andamento"

- [x] T2.1 Teste coberto pelo e2e (T5.1) + card: ongoing → "em andamento · até {endsAt}"; sem endsAt → "em andamento"; futuro inalterado; linha de inscrições mantida
- [x] T2.2 `components/HackathonCard.tsx` — estado ongoing no campo data

## Fase 3 — Scraper coerente

- [x] T3.1 Testes falhando em `scripts/test_scrape_radar.py`: is_expired com deadline futuro + start passado → False; sweep_expired poupa evento com `registrationDeadline` futuro
- [x] T3.2 `scripts/scrape_radar.py`: `is_expired` e `sweep_expired` com `COALESCE(endsAt, registrationDeadline, startsAt)`

## Fase 4 — Momentum na landing

- [x] T4.1 Testes falhando em `tests/unit/radar-ongoing.test.ts`: `getStatsMomentum` conta members/posts `createdAt` 30d e eventos `first_seen` 30d ainda abertos; ignora NULL `first_seen`; zero honesto
- [x] T4.2 `lib/db.ts`: migração idempotente `first_seen`/`last_seen`; `lib/momentum.ts` novo com `getStatsMomentum(now)`
- [x] T4.3 `app/page.tsx`: sub-linha "+N · 30d" sob o stat quando >0; arquivo sem sub-linha

## Fase 5 — e2e + gate

- [x] T5.1 `tests/e2e/radar-ongoing.spec.ts`: evento ongoing aparece em `/radar` com "em andamento"; landing renderiza "+N · 30d" quando há o que contar
- [x] T5.2 lint + typecheck + build + test + test:scrape + test:e2e verdes
- [x] T5.3 spec/tasks atualizadas (checkboxes)
