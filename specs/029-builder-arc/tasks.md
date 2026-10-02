# Tasks: Trajetória do Builder no Perfil

**Feature**: `029-builder-arc` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/archive.test.ts` — describe `getMemberArc`: ordenação cronológica (inserção fora de ordem), placement do time, inscrito-sem-time ("participou"), time-sem-inscrição, inscrito+time dedup, hasProject, vazio → []
- [x] T1.2 `lib/archive.ts`: `MemberArcEntry` + `getMemberArc(username)`

## Fase 2 — UI no perfil

- [x] T2.1 `app/u/[username]/page.tsx` — seção "// trajetória" antes de "projetos": resumo + faixa de chips por desfecho, só quando `arc.length > 0`

## Fase 3 — E2E

- [x] T3.1 `tests/e2e/builder-arc.spec.ts` — seeda membro em time campeão + inscrição sem time + time com projeto (pattern `talento.spec.ts`); assert chips, ordem, links `/h/[id]` e linha-resumo

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
