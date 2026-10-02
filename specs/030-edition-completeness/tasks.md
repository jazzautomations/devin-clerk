# Tasks: Completude da Edição

**Feature**: `030-edition-completeness` | TDD: testes antes da implementação.

## Fase 1 — Semântica ongoing (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/arena.test.ts` — `ongoing` na matriz (startsAt passado + endsAt futuro; endsAt==now ainda ongoing; deadline futuro sem endsAt segura), closed-soon só com endsAt válido, `countdownTarget` ongoing → `kind:"end"`/deadline, ended/archived seguem null
- [x] T1.2 `lib/arena.ts`: `EditionPhase + "ongoing"`; `endRef` = COALESCE(endsAt, registrationDeadline, startsAt); `CountdownTarget.kind + "end"`; alvo ongoing
- [x] T1.3 `app/h/[id]/page.tsx`: `past = isOver(h, now)`; `PHASE_LABEL.ongoing = "em andamento"` + classe acento; label countdown "termina em"; `live` prop cobre ongoing

## Fase 2 — Submissão rica (testes primeiro)

- [x] T2.1 Testes falhando: `tests/unit/teams.test.ts` (submit/update aceitam e persistem videoUrl/logoUrl, 400 não-http, PATCH limpa com "") e `tests/unit/archive.test.ts` (getArchive/getMemberProjects/getProjectByTeamId devolvem os campos, null em projeto antigo)
- [x] T2.2 `lib/archive.ts`: guarded ALTER `team_projects.videoUrl`/`logoUrl`; `TeamProject` + SELECTs das 3 leituras
- [x] T2.3 `lib/teams.ts`: `ProjectInput`/`ProjectPatch` + validação http(s) + INSERT/UPDATE com as colunas
- [x] T2.4 `tests/api/team.test.ts`: POST/PATCH aceitam os campos (201/200 com persistência) e 400 em não-http(s)
- [x] T2.5 `app/api/hackathons/[id]/team/route.ts`: PATCH repassa `videoUrl`/`logoUrl`

## Fase 3 — UI

- [x] T3.1 `components/MyTeamPanel.tsx`: inputs "vídeo (url)"/"logo (url)" no create e no edit; hidrata no `openEdit`; payloads completos
- [x] T3.2 `app/p/[teamId]/page.tsx`: `▶ vídeo` externo junto a repo/demo + entra no "tem links"
- [x] T3.3 `lib/projects.ts` + `app/projetos/page.tsx`: `logoUrl` no SELECT/card → thumb 32px quando presente
- [x] T3.4 Teste BDD falhando: `tests/e2e/edition-completeness.spec.ts` — `/h` ongoing mostra arena "em andamento" sem "resultado"; `/p` mostra `▶ vídeo`; `/projetos` mostra logo; edição encerrada segue arquivo

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
