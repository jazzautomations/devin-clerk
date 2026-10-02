# Tasks: Arena ao Vivo

**Feature**: `016-live-arena` | TDD: testes antes da implementação.

## Fase 1 — lib pura (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/arena.test.ts` — `editionPhase` (matriz: open/closed-soon/live/ended/archived + boundaries 48h/startsAt/deadline/+7d), `countdownTarget` (deadline antes vs. depois vs. passado vs. null), `countdownParts` (decomposição exata, clamp em zero, alvo inválido)
- [x] T1.2 `lib/arena.ts`: `editionPhase`, `countdownTarget`, `countdownParts`, `LIVE_WINDOW_MS`, `ARCHIVE_GRACE_MS`

## Fase 2 — Render (e2e primeiro)

- [x] T2.1 Teste BDD falhando: `tests/e2e/arena.spec.ts` — faixa com dígitos `DD:HH:MM:SS` tickando, "N inscritos", edição passada sem faixa
- [x] T2.2 `components/ArenaCountdown.tsx` — client, SSR-safe via `nowIso`, intervalo 1s
- [x] T2.3 `app/h/[id]/page.tsx` — faixa de arena no topo quando `!past` (fase + countdown + inscritos)

## Fase 3 — Gate

- [x] T3.1 lint + typecheck + build + test + test:e2e verdes
- [ ] T3.2 commit (bloqueado: DO NOT git commit nesta sessão)
