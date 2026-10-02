# Implementation Plan: Índice de Projetos

**Branch**: `017-projects-index` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

## Summary

`/projetos` vira o índice público de tudo que já nasceu nos hackathons — o
`/companies` do Colosseum. `lib/projects.ts` novo (`listProjects`) faz um
SELECT único `teams ⋈ team_projects ⋈ hackathons` (INNER: só quem entregou)
com contagem de membros via subquery; o flag "demo ao vivo" vem de
`getLatestDeployForTeam` por linha (N pequeno; mesma regra de `/p`). Página
server component com grid de cards, filtros `?h=`/`?live=1` via searchParams,
metadata + canonical, rota no sitemap e link no header.
TDD: unit + e2e falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — somente leitura; `lib/db.ts` intacto
  (trabalho paralelo). A tabela `deploys` é garantida pelo import de
  `lib/deploys.ts` (schema próprio no módulo — pattern do spec 008)
- **Testing**: Vitest (unit, `HACKAHUB_DB=:memory:`) + Playwright (BDD público
  contra `data/hackahub.db` com seed)
- **Padrão de dados**: `lib/projects.ts` novo — mesmo estilo de
  `lib/archive.ts` / `lib/members.ts`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: índice 100% público, sem login ✅
- III. Auth: nenhuma escrita — feature é read-only ✅
- IV. One-session scope: uma lib + uma página + wiring em uma sessão ✅
- V. No slop UI: pódio primeiro com token lendário, chip ao vivo só quando real ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Times sem projeto | INNER JOIN `team_projects` — fora do índice | O índice é de projetos entregues; o arquivo `/h/[id]` já lista participantes |
| Flag "demo ao vivo" | `getLatestDeployForTeam(teamId)` por linha, `status === 'running'` | Idêntico a `/p/[teamId]` — regra em um lugar só; N pequeno (volumetria do arquivo); import de `lib/deploys` também garante a tabela em bancos `:memory:` de teste |
| Ordenação | `CASE WHEN placement=0 THEN 99 ELSE placement END, h.startsAt DESC` | Mesmo pattern de `getArchive` pro pódio; edição recente desempata |
| Membros | `(SELECT COUNT(*) FROM team_members …)` na query principal | Um SQL só, sem N+1 pro contador |
| Filtros | `?h=<hackathonId>` + `?live=1` via `searchParams` (Promise, await) | Pattern de `/membros`; server-side, chips são `<Link>` — sem client component |
| `live` no lib | filtro em JS depois de computar o flag por linha | flag já é calculado por linha; SQL fica limpo |
| Chips de edição | `listProjectEditions()` — DISTINCT das edições com projeto | Página não deriva nada; helper testável |

## Phase 1 — Design

### data-model.md

Nenhuma tabela nova. Leitura:

```sql
teams t ⋈ team_projects tp (INNER, teamId PK) ⋈ hackathons h
  + (SELECT COUNT(*) FROM team_members WHERE teamId = t.id) AS memberCount
  + getLatestDeployForTeam(t.id) por linha → liveDeployId | null
```

`listProjects({ hackathonId?, liveOnly? }) → ProjectCard[]`
`listProjectEditions() → { id, name }[]` (edições que têm projeto, `startsAt` desc)

### contracts

Sem API nova — leitura embutida no render de `/projetos`.
Querystring: `?h=<hackathonId>` (edição), `?live=1` (só ao vivo). Combináveis.

### quickstart.md

1. `npm run test` + `npm run test:e2e` verdes
2. `curl /projetos` → contém "o que já nasceu aqui" + card One Day Hospital com "1º lugar"
3. `curl '/projetos?h=nao-existe'` → 200 com empty state
4. `curl -s /projetos | grep -o 'rel="canonical" href="[^"]*"'` → `/projetos`
