# Tasks: Blog + Infra de SEO

**Feature**: `009-blog-seo` | TDD: testes antes da implementação.

## Fase 1 — Blog engine (testes primeiro)

- [x] T1.1 Testes falhando: `tests/unit/blog.test.ts` — parsePost (campos, tags, data inválida, frontmatter ausente), listPosts (ordem desc, só .md, excerpt), getPost (slug traversal → null), renderMarkdown (h2, listas, fence, inline code, bold/italic, links, escape, js: removido)
- [x] T1.2 `lib/blog.ts` — parser frontmatter + renderer md mínimo, sem deps
- [x] T1.3 `content/blog/` — 3 posts PT-BR reais (prep IA-saúde, recap Unifacens, guia deploy)

## Fase 2 — SEO lib + rotas especiais (testes primeiro)

- [x] T2.1 Testes falhando: `tests/unit/seo.test.ts` — buildSitemap cobre estáticas + /h/* + /blog/*, buildRobots aponta sitemap, eventJsonLd/articleJsonLd com @type correto, jsonLd escapa `<`, absoluteUrl
- [x] T2.2 `lib/seo.ts` + `app/sitemap.ts` + `app/robots.ts`

## Fase 3 — Páginas + metadata (e2e primeiro)

- [x] T3.1 Teste e2e falhando: `tests/e2e/blog.spec.ts` — lista, artigo com canonical/og:article/JSON-LD, /h/[id] com og:title/Event, sitemap 200 contém /blog, robots, link no header
- [x] T3.2 `app/blog/page.tsx` + `app/blog/[slug]/page.tsx` + `.blog-body` em globals.css + link no Header
- [x] T3.3 Metadata: layout (metadataBase/template/OG), generateMetadata em /h/[id] + /u/[username] + /blog/[slug], metadata em /blog,/radar,/membros,/feed; JSON-LD em /h/[id] e /blog/[slug]
- [x] T3.4 `app/opengraph-image.tsx` — HACKAHUB dark+accent via ImageResponse

## Fase 4 — Gate

- [x] T4.1 lint + typecheck + build + test + test:e2e verdes
- [ ] T4.2 commit (bloqueado: instrução da sessão — não commitar)
