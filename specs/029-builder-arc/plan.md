# Implementation Plan: Trajetória do Builder no Perfil

**Branch**: `029-builder-arc` | **Date**: 2026-12-05 | **Spec**: [spec.md](./spec.md)

## Summary

`getMemberArc(username)` em `lib/archive.ts` — união de
`registrations` (via memberId) e `team_members` (via username) por
edição, LEFT JOIN no time do membro + `team_projects`, ordenado
`startsAt ASC`. `/u/[username]` ganha a seção "// trajetória" antes de
"projetos": linha-resumo (`N edições · W pódios · P projetos entregues`)
+ faixa horizontal de chips de desfecho linkando `/h/[id]`. TDD: testes
unit e e2e falhando antes do código.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Storage**: SQLite via `lib/db.ts` — NÃO edita (schema de 003 cobre)
- **Testing**: Vitest (unit, `HACKAHUB_DB=:memory:`) + Playwright (seed direto no `data/hackahub.db`, pattern de `talento.spec.ts`)
- **Padrão de dados**: função nova em `lib/archive.ts`, ao lado de `getMemberProjects` — mesma fonte (teams/team_members/team_projects), mesma cara de row-mapping
- **UI**: server component puro na página existente — sem componente novo, sem client JS

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅ (este arquivo)
- II. Community-first: trajetória celebra participação, não só pódio — "participou" é primeira-classe ✅
- III. Auth: leitura pública — perfil já é público, nada autenticado ✅
- IV. One-session scope: uma query + uma seção de página + testes ✅
- V. No slop UI: faixa narrativa com desfechos, não tabela CRUD ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Onde mora | `lib/archive.ts` | mesma fonte de `getMemberProjects`; `lib/members.ts` não conhece teams |
| Base do arco | `UNION` de registrations (memberId) e team_members (username) | admin vincula por username sem exigir inscrição — vínculo já é participação |
| Dedup edição | `UNION` (não `UNION ALL`) + uma linha por hackathon | inscrito E com time = uma entrada só, com dados do time |
| Múltiplos times/edição | subquery pega o de melhor placement (`CASE WHEN BETWEEN 1 AND 3 … ELSE 99`) | invariante de 021 diz que não acontece, mas o legado do admin não garante — determinismo barato |
| placement > 3 | cai em "participou"/"entregou" | select do admin só emite 0–3 |
| Retorno vazio | `[]` | chamador (`page.tsx`) já faz `length > 0` |
| Posição na página | antes de "projetos", depois de "coleção" | arco é a camada narrativa sobre o inventário |

## Phase 1 — Design

### data-model.md

Sem schema novo. Query (nomeado `@username`, CTE + subquery correlacionada):

```sql
WITH editions AS (
  SELECT r.hackathonId FROM registrations r
   JOIN members m ON m.id = r.memberId WHERE m.username = @username
  UNION
  SELECT t.hackathonId FROM team_members tm
   JOIN teams t ON t.id = tm.teamId WHERE tm.username = @username
)
SELECT h.id AS hackathonId, h.name AS hackathonName, h.startsAt,
       t.id AS teamId, t.name AS teamName,
       COALESCE(t.placement, 0) AS placement,
       CASE WHEN tp.teamId IS NULL THEN 0 ELSE 1 END AS hasProject
FROM editions e
JOIN hackathons h ON h.id = e.hackathonId
LEFT JOIN teams t ON t.id = (
  SELECT t2.id FROM team_members tm2 JOIN teams t2 ON t2.id = tm2.teamId
  WHERE tm2.username = @username AND t2.hackathonId = h.id
  ORDER BY CASE WHEN t2.placement BETWEEN 1 AND 3 THEN t2.placement ELSE 99 END, t2.id
  LIMIT 1)
LEFT JOIN team_projects tp ON tp.teamId = t.id
ORDER BY h.startsAt ASC, h.id ASC
```

### contracts/ui.md

`/u/[username]` — seção nova entre "coleção" e "projetos":

```tsx
{arc.length > 0 && (
  <div className="flex flex-col gap-3">
    <h2>// trajetória</h2>
    <p>{n} edições · {wins} pódios · {projects} projetos entregues</p>
    <ol aria-label="trajetória">
      {arc.map(e => <li><Link href={`/h/${e.hackathonId}`}>{name} → chip</Link></li>)}
    </ol>
  </div>
)}
```

Desfecho: `placement` 1/2/3 → `Nº lugar` lendário/épico/raro; senão
`hasProject` → `entregou projeto` accent; senão `participou` muted.
