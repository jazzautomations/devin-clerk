# Tasks: Mural da Edição

**Feature**: `028-edition-feed` | TDD: testes antes da implementação.

## Fase 1 — Lib (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/edition-feed.test.ts` — ALTER guardado (coluna existe); createPost escopado retorna hackathonId+hackathonName; listPosts omitido=agregado, `{hackathonId}`=só edição, `{global:true}`=só globais
- [x] T1.2 `lib/posts.ts`: guarded ALTER `posts.hackathonId`; SELECT com `LEFT JOIN hackathons` (+`hackathonName`); `PostScope`; `listPosts` com `scope`; `createPost` com 4º arg

## Fase 2 — API

- [x] T2.1 Teste falhando: `tests/api/posts-edition.test.ts` — POST 401-anon / 400-não-string / 404-inexistente / 400-inativa / 403-não-inscrito / 201-inscrito (com chip join) / 201-sem-escopo (hackathonId null); GET `?h=` filtra / `?h=` inválido 404 / sem `?h=` agrega
- [x] T2.2 `app/api/posts/route.ts` — GET aceita `req` e `?h=`; POST valida hackathonId (string→edição→inscrição)

## Fase 3 — UI

- [x] T3.1 Teste BDD falhando: `tests/e2e/edition-feed.spec.ts` — `/h/[id]` mostra "// mural da edição" + post seedado; anon vê posts mas não composer; POST deslogado com hackathonId → 401 JSON; `/feed` mostra chip →/h/
- [x] T3.2 `components/FeedSection.tsx` — props `hackathonId`/`editionLabel`; POST e refresh escopados; chip `→ nome` no card; hint "// só inscritos postam no mural" quando escopado e `!canPost`
- [x] T3.3 `app/h/[id]/page.tsx` — seção "// mural da edição" append-only após "inscritos"; `canPost = member && registered`

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [x] T4.2 spec/tasks atualizadas (checkboxes)
