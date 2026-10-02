# Implementation Plan: Completude da Edição

**Branch**: `030-edition-completeness` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Dois fixes ligados. (A) `/h/[id]` alinha `past` ao `isOver` de 027 e
`lib/arena.ts` ganha a fase `ongoing` (começou, não acabou) com alvo de
countdown `kind: "end"` ("termina em") — evento rolando volta a parecer
vivo. (B) `team_projects` ganha `videoUrl`/`logoUrl` via `ALTER` guardado
em `lib/archive.ts`; `submitTeam`/`updateTeamProject` aceitam os campos
(http(s) obrigatório), `MyTeamPanel` ganha os inputs, `/p` mostra
`▶ vídeo` e `/projetos` thumb de logo 32px. TDD: testes unit/API/e2e
falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — NÃO edita; migração vive em `lib/archive.ts`
- **Testing**: Vitest (unit+API, Clerk mockado) + Playwright (páginas públicas)
- **Padrão de dados**: coluna nullable + guarded ALTER — mesmo pattern do
  `avatarUrl` em `lib/posts.ts`/`lib/members.ts`
- **Fronteira temporal**: `isOver` (spec 027) é a fonte única — a página
  não recalcula `startsAt`, só consome

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: evento rolando mostra CTA/form — participação não morre no `startsAt` ✅
- III. Auth: nenhum gate muda — escrita continua autenticada + inscrito ✅
- IV. One-session scope: fase nova + 2 colunas + 3 superfícies ✅
- V. No slop UI: "em andamento"/"termina em" e `▶ vídeo` seguem a linguagem já usada no radar ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| `past` na página | `isOver(h, now)` | uma fronteira só — radar, sitemap e detalhe nunca divergem; recalcular `startsAt` na página foi o bug |
| Fase nova vs. reusar `live` | `ongoing` próprio | `live` = "começando" (pré-evento ≤48h); fundir apagaria a distinção e o label correto ("em andamento") |
| Fim efetivo na arena | `endsAt ?? registrationDeadline ?? startsAt` | mesma COALESCE do `isOver` — `ended`/`archived` passam a ser "over dentro/fora da grace", nunca "started" |
| `closed-soon` alcançável? | só com `endsAt` válido futuro | sem `endsAt`, deadline passado já é `over` (deadline é proxy de fim, 027) — comportamento herdado, não contradição |
| Alvo do countdown ongoing | `endsAt` → `kind: "end"` ("termina em"); fallback deadline futuro → "deadline" | ongoing implica algum fim efetivo futuro; o relógio aponta pra ele — "começa em" num evento rolando seria mentira |
| Colunas novas | `ALTER` guardado em `lib/archive.ts` | dono do agregado `TeamProject`; `lib/db.ts` intocado; `lib/projects.ts` ganha `import "@/lib/archive"` de efeito (import de tipo não roda o ALTER) |
| Vídeo na ficha | link `▶ vídeo`, sem embed | portal externo (YouTube/Loom); embed traria CSP/cookies — link segue o padrão repo/demo |
| Logo no card | `<img>` 32px quando `logoUrl`; nada quando null | sem placeholder inventado — card sem logo continua honesto |
| `createTeam` (admin) | inalterado | spec cobre o caminho self-service; admin mantém os 4 campos |

## Phase 1 — Design

### data-model.md

- `team_projects.videoUrl TEXT NULL`, `team_projects.logoUrl TEXT NULL` —
  `PRAGMA table_info(team_projects)` + `ALTER TABLE` no topo de
  `lib/archive.ts`. NULL = campo não preenchido; zero backfill.
- `TeamProject`/`ProjectInput`/`ProjectPatch` ganham os dois campos;
  `EditionPhase` ganha `"ongoing"`; `CountdownTarget.kind` ganha `"end"`.

### contracts/api.md

`app/api/hackathons/[id]/team/route.ts` (contratos de 021 + campos):

- `POST` body `project` aceita `videoUrl?`/`logoUrl?` — validação dentro
  de `validateProject` (400 não-http(s)).
- `PATCH` body aceita `videoUrl?`/`logoUrl?` ao lado de
  `title`/`description`/`repoUrl`/`demoUrl` — repassados ao
  `updateTeamProject`; 200 `{team}` com `project` completo.
- `GET` retorna o `team` com `project.videoUrl`/`logoUrl` — hidrata o
  formulário de edição.

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. Evento ongoing seedado (`startsAt` -3d, `endsAt` +10d):
   `curl localhost:3000/h/e2e-ongoing-jam` → faixa "em andamento",
   countdown "termina em", sem heading "resultado"
3. `PATCH /api/hackathons/[id]/team` com `videoUrl`/`logoUrl` → 200;
   `/p/[teamId]` mostra `▶ vídeo`, `/projetos` mostra thumb 32px
