# Implementation Plan: Blog + Infra de SEO

**Branch**: `009-blog-seo` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

## Summary

Blog file-based: `content/blog/*.md` com frontmatter parseado por
`lib/blog.ts` (parser próprio, sem deps) + renderer markdown mínimo
(~60 linhas). SEO centralizado em `lib/seo.ts`: `SITE_URL`,
`buildSitemap()`, `buildRobots()`, `eventJsonLd()`, `articleJsonLd()`,
`jsonLd()` — consumidos por `app/sitemap.ts`, `app/robots.ts` e pelas
páginas. TDD: unit (blog lib + seo lib) e e2e (blog, metadata, JSON-LD,
sitemap) falhando antes de implementar.

## Technical Context

- **Language**: TypeScript / Next.js 16.3.5 App Router
- **Content**: `content/blog/*.md` lidos via `node:fs` no servidor
- **SEO**: Metadata API (`metadata`, `generateMetadata` com params
  await'd), `MetadataRoute.Sitemap`/`Robots`, `ImageResponse` de `next/og`
  (fonte Geist bundled — sem fonte externa)
- **Testing**: Vitest (unit — dirs tmp pra posts, lib pura) + Playwright
  (e2e contra dev server :3000)

## Constitution Check

- I. Spec-driven: spec → plan → tasks → implement ✅
- II. Community-first: blog é público, sem login ✅
- III. Auth: nenhuma rota de escrita nova ✅
- IV. One-session scope: engine + 3 posts + SEO em uma sessão ✅
- V. No slop UI: lista estilo feed, tipografia `.blog-body` dedicada ✅

## Phase 0 — Research (decisões)

| Decisão | Escolha | Racional |
|---|---|---|
| Storage do blog | `content/blog/*.md` + `node:fs` | Simples, versionado, sem CMS; specs de banco ficam pra dados sociais |
| Markdown | renderer próprio ~60 linhas | Zero deps; subconjunto controlado; escaping nativo |
| Base URL | `NEXT_PUBLIC_SITE_URL` → fallback `https://hackahub.dev` | Documentado em PRODUCTION; placeholder explícito em dev |
| OG image | `app/opengraph-image.tsx` com `ImageResponse` (next/og) | Fonte Geist já vem bundled no pacote; imagem estática por build |
| JSON-LD | funções puras em `lib/seo.ts` + `<script>` na página | Testável em unit; escape `\u003c` centralizado |
| Metadata dinâmica | `generateMetadata` async com `await params` (Next 16) | params é Promise — padrão novo da versão |
| Testes unit do blog | `listPosts(dir?)`/`getPost(slug, dir?)` aceitam dir | Fixtures em `mkdtemp` — hermético, sem depender do conteúdo real |

## Phase 1 — Design

### Arquivos novos

```
content/blog/como-vencer-um-hackathon-de-ia-na-saude.md
content/blog/o-que-rolou-no-hack-inova-unifacens.md
content/blog/deploy-da-demo-em-5-min.md
lib/blog.ts            — parsePost, listPosts, getPost, renderMarkdown
lib/seo.ts             — SITE_URL, absoluteUrl, buildSitemap, buildRobots,
                         eventJsonLd, articleJsonLd, jsonLd
app/blog/page.tsx      — lista (metadata + canonical)
app/blog/[slug]/page.tsx — artigo (generateMetadata article + JSON-LD)
app/sitemap.ts         — delega pra buildSitemap()
app/robots.ts          — delega pra buildRobots()
app/opengraph-image.tsx — ImageResponse 1200x630 dark+accent
specs/009-blog-seo/*   — este spec
tests/unit/blog.test.ts, tests/unit/seo.test.ts, tests/e2e/blog.spec.ts
```

### Arquivos tocados (mínimo)

- `app/layout.tsx` — `metadataBase`, `title{default,template}`, OG/twitter defaults
- `app/h/[id]/page.tsx` — `generateMetadata` + `<script ld+json>` (só isso)
- `app/u/[username]/page.tsx` — `generateMetadata` (permitido)
- `app/radar|feed|membros/page.tsx` — `export const metadata`
- `components/Header.tsx` — link "blog" na nav
- `app/globals.css` — bloco `.blog-body` (tipografia do artigo)

### Contratos internos

```ts
// lib/blog.ts
type PostMeta = { slug, title, description, date, author, tags[] }
listPosts(dir = content/blog): (PostMeta & { excerpt })[]
getPost(slug, dir): (PostMeta & { excerpt, html }) | null
parsePost(source, slug): PostMeta & { body }   // throw em campo ausente
renderMarkdown(md): string                      // escapa HTML cru

// lib/seo.ts
SITE_URL = env NEXT_PUBLIC_SITE_URL ?? "https://hackahub.dev"
absoluteUrl(path), jsonLd(data) // JSON.stringify + < → \u003c
buildSitemap(): MetadataRoute.Sitemap
buildRobots(): MetadataRoute.Robots
eventJsonLd(h: Hackathon), articleJsonLd(post: PostMeta)
```

### quickstart

1. `npm run test` verde (blog lib + seo lib)
2. `npm run test:e2e` verde (blog render, meta/JSON-LD, sitemap/robots)
3. `curl /sitemap.xml | grep /blog` → posts listados
4. `view-source:/h/hack-inova-unifacens-2026` → `og:title` + ld+json Event
