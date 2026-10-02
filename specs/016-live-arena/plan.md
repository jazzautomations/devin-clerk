# Implementation Plan: Arena ao Vivo

**Branch**: `016-live-arena` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

`/h/[id]` ganha uma faixa de arena no topo (só em edição futura): fase
(`open`/`closed-soon`/`live`), countdown `DD:HH:MM:SS` client-side SSR-safe e
"N inscritos". Toda a decisão vive em `lib/arena.ts` puro — `editionPhase`,
`countdownTarget`, `countdownParts` — testado por matriz de unidade. Render via
`components/ArenaCountdown.tsx` (`"use client"`, estado inicial do servidor +
intervalo de 1s). TDD: testes falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: nenhum — fase é derivada de colunas já existentes (`startsAt`, `endsAt`, `registrationDeadline`)
- **Testing**: Vitest (`tests/unit/arena.test.ts`, puro, sem db) + Playwright (`tests/e2e/arena.spec.ts`, página pública)
- **Padrão de dados**: `lib/arena.ts` novo, `import type` de `lib/hackathons` — zero db, zero relógio global

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: faixa é pública, sem login ✅
- III. Auth: nada de escrita — só render ✅
- IV. One-session scope: lib pura + 1 componente + strip na página ✅
- V. No slop UI: countdown mono com `tabular-nums`, fase com hierarquia real ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| `live` exige inscrição aberta | sim — `startsAt - now ≤ 48h && regOpen` | fechado + perto = `closed-soon`, não "ao vivo" |
| `archived` vs `ended` | grace de 7d pós-`endsAt` (ou `startsAt`) | recém-terminado ≠ histórico; render igual hoje |
| Alvo do countdown | deadline futuro < startsAt → deadline; senão startsAt | urgência real: inscrição fecha antes do hype |
| SSR-safe | prop `nowIso` fixa o valor inicial; `useEffect` ticka com `Date.now()` | HTML já traz dígitos; hydrate idêntico, sem flash |
| Boundary `deadline = now` | ainda aberto (`deadline < now` fecha) | coerente com `isRegistrationClosed` de `lib/hackathons` |
| Onde entra na página | depois do bloco título, antes do `<dl>` | topo da dobra, sem reordenar seções existentes |

## Phase 1 — Design

### lib/arena.ts (contrato)

```ts
type EditionPhase = "open" | "closed-soon" | "live" | "ended" | "archived";
editionPhase(h: Hackathon, now: Date): EditionPhase
countdownTarget(h, now): { iso: string; kind: "deadline" | "start" } | null
countdownParts(targetIso: string, now: Date): { d: number; h: number; m: number; s: number }
```

Constantes exportadas: `LIVE_WINDOW_MS = 48h`, `ARCHIVE_GRACE_MS = 7d`.

### components/ArenaCountdown.tsx

Props: `{ targetIso, nowIso, label, live? }`. Estado inicial =
`countdownParts(targetIso, new Date(nowIso))`; `setInterval` de 1s re-computa
com `new Date()`. `data-testid="arena-countdown"`, dígitos `font-mono`
`tabular-nums` grandes, `label` em cima em muted.

### app/h/[id]/page.tsx (diff mínimo)

- `const phase = editionPhase(h, now)` + `const countdownTo = countdownTarget(h, now)` junto aos consts existentes
- Bloco novo `{!past && countdownTo && (...)}` com `data-testid="arena-strip"`,
  `arena-phase` (classes por fase) e `arena-attendees` (`N inscritos` +
  `N procurando time` quando `boardEntries.length > 0`)

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /h/hack-inova-alphaville-2026` → contém `arena-countdown` com dígitos e `arena-attendees`
3. Edição passada (`/h/hack-inova-unifacens-2026`) → sem `arena-strip`, resto igual
