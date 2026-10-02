# Implementation Plan: Páginas de Projeto

**Branch**: `010-project-pages` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Cada projeto do arquivo ganha URL própria: `/p/[teamId]` (server
component público). Nova query `getProjectByTeamId` em `lib/archive.ts`
junta team + project + members + edição em uma leitura. Títulos de
projeto em `/h/[id]` (pódio + lista) e em `/u/[username]` viram links —
diff mínimo, só envolvendo o texto existente. `generateMetadata` emite
og:title do projeto. Demo `running` vira CTA pra `/demo/[id]/` (sem
iframe — X-Frame-Options não é nosso). TDD: unit da query e e2e da
rota falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router (`params` é `Promise`)
- **Storage**: SQLite via `lib/db.ts` — somente leitura, nenhuma tabela nova
- **Testing**: Vitest (unit da query, `HACKAHUB_DB=:memory:`) + Playwright (BDD público, dev server :3000)
- **Padrão de dados**: `getProjectByTeamId` em `lib/archive.ts` — mesmo estilo de `getArchive`/`getMemberProjects`
- **Deploy**: `getLatestDeployForTeam` de `lib/deploys.ts` (read-only) decide o CTA `/demo/[id]/`

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: página pública, sem auth, dados do arquivo ✅
- III. Auth: nenhuma escrita — rota 100% leitura, proxy.ts não protege `/p` ✅
- IV. One-session scope: 1 query + 1 página + 2 wraps de link ✅
- V. No slop UI: ficha com hierarquia real (título display, badge de colocação, CTA de demo), empty states honestos ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Chave da rota | `teamId` (inteiro) | `team_projects.teamId` é PK — 1 projeto por time; slug é cosmético pra outra spec |
| Time sem projeto | 404 | A página é do projeto; o time sem projeto já aparece no arquivo da edição |
| Onde mora a query | `lib/archive.ts` | É leitura do arquivo — junto de `getArchive`/`getMemberProjects`, reusa os types |
| Demo ao vivo | CTA link `/demo/[id]/`, sem iframe | X-Frame-Options do app deployado não é controlado; tombstone já existe na rota demo |
| Status de deploy que linka | só `running` | queued/building não serve nada; failed/stopped/expired caem no tombstone |
| Colocação | 1º = token `lendario`; 2º/3º neutro; 0 sem badge | mesmo visual do pódio em `/h/[id]` |

## Phase 1 — Design

### data-model.md

Nenhuma tabela nova. Leitura derivada:

```sql
getProjectByTeamId(teamId):
  teams t JOIN hackathons h ON h.id = t.hackathonId
          JOIN team_projects tp ON tp.teamId = t.id   -- INNER: sem projeto = 404
  WHERE t.id = ?
  + SELECT username FROM team_members WHERE teamId = ? ORDER BY username
```

Retorna `{ teamId, teamName, placement, hackathonId, hackathonName, members[], project{title,description,repoUrl,demoUrl} }` ou `null`.

### Rotas

- `app/p/[teamId]/page.tsx` — server component; `params: Promise<{ teamId: string }>`; parse inteiro → `notFound()` em NaN/nulo
- `generateMetadata` — mesma query; título/descrição/openGraph; inexistente → metadata neutra
- Wiring: `<Link href={\`/p/${t.id}\`}>` envolvendo `t.project.title` em `/h/[id]` (pódio + field) e `p.project.title` em `/u/[username]`

### quickstart.md

1. `npm run test` verde; `npm run test:e2e` verde
2. `curl /h/hack-inova-unifacens-2026 | grep -o '/p/[0-9]*'` → link do One Day Hospital
3. `curl /p/<id> | grep og:title` → "One Day Hospital"; `curl -o /dev/null -w %{http_code} /p/999999` → 404
