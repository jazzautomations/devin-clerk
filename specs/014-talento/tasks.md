# Tasks: Talento — diretório de quem entrega

**Feature**: `014-talento` | TDD: testes antes da implementação.

## Fase 1 — Coluna + lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/talent.test.ts` — setOpenTo valida whitelist + dedupe + limpa com [], listTalent só opted-in, ordena xp desc, projects count + best placement
- [x] T1.2 `lib/openTo.ts` (constante pura + parser) e `lib/talent.ts` (migração idempotente `openTo`, setOpenTo, getOpenTo, listTalent)

## Fase 2 — API + formulário

- [x] T2.1 Teste falhando: `tests/api/talent.test.ts` — PATCH openTo aceita whitelist, rejeita inválido/não-array com 400, ausente preserva
- [x] T2.2 `app/api/members/me/route.ts`: validação openTo + `setOpenTo(member.id, …)`
- [x] T2.3 `components/ProfileForm.tsx` + `app/perfil/page.tsx`: seletor multi-chip "open to"

## Fase 3 — Render pública

- [x] T3.1 Teste BDD falhando: `tests/e2e/talento.spec.ts` — /talento 200 + heading, membro seedado com openTo aparece com chips e pódio, /perfil redireciona deslogado
- [x] T3.2 `app/talento/page.tsx`: diretório com chips acentuados de openTo, LV/xp, skills, projetos + melhor colocação, github
- [x] T3.3 `components/Header.tsx`: link "talento" na nav; `/talento` no sitemap

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
