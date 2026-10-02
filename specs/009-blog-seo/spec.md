# Feature Specification: Blog + Infra de SEO

**Feature**: `009-blog-seo`
**Created**: 2026-10-12
**Status**: Draft
**Input**: Blog file-based (markdown em `content/blog/`) + camada de SEO completa — sitemap, robots, metadata por página, JSON-LD (Event nas edições, Article nos posts) e OG image. O conteúdo escrito é o que faz o hackahub aparecer no Google quando alguém procura "hackathon brasil", "como vencer hackathon" ou o nome de uma edição.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante lê um post do blog (Priority: P1)

Alguém chega pelo Google ou pelo link no header, abre `/blog`, vê a lista de posts (título, data, resumo, tags) e clica num post pra ler o artigo completo com tipografia legível. Conteúdo real em PT-BR: guias de preparação, recaps de edições e tutoriais da plataforma.

**Why this priority**: O blog é a superfície de aquisição — cada post é uma porta de entrada orgânica. Sem leitura boa, o resto do SEO não importa.

**Independent Test**: Abrir `/blog`, clicar no recap da Unifacens e ler o artigo — sem login, sem outra feature.

**Acceptance Scenarios**:

1. **Given** existem posts em `content/blog/`, **When** visitante abre `/blog`, **Then** vê lista ordenada por data (mais recente primeiro) com título, data, resumo e tags
2. **Given** um post na lista, **When** visitante clica, **Then** abre `/blog/[slug]` com o artigo renderizado (títulos, listas, código, links) e link "voltar pro blog"
3. **Given** slug inexistente, **When** visitante abre `/blog/[slug]`, **Then** recebe 404
4. **Given** o header, **When** visitante olha a nav, **Then** existe link "blog" entre membros e dashboard

---

### User Story 2 - Busca indexa e redes sociais renderizam preview (Priority: P1)

Google/Bing descobrem todas as rotas públicas via `/sitemap.xml` (estáticas + `/h/[id]` + `/u/[username]` + `/blog/[slug]`) e respeitam `/robots.txt`. Cada página compartilhada no WhatsApp/Twitter/LinkedIn mostra título, descrição e imagem OG corretos — edição mostra dados do evento, post mostra dados do artigo.

**Why this priority**: É o "SEO" do nome da feature — sem metadata por página e sitemap, o blog não ranqueia e os links compartilhados ficam sem preview.

**Independent Test**: `curl /sitemap.xml` lista `/blog` e `/h/...`; HTML de `/h/hack-inova-unifacens-2026` tem `og:title` com o nome da edição e `script[type="application/ld+json"]` com `@type: Event`.

**Acceptance Scenarios**:

1. **Given** o site no ar, **When** crawler pede `/sitemap.xml`, **Then** recebe XML com rotas estáticas, todas as edições `/h/[id]`, membros `/u/[username]` e posts `/blog/[slug]`
2. **Given** crawler pede `/robots.txt`, **Then** recebe `Allow: /` e a URL do sitemap
3. **Given** página de edição, **When** inspeciona o `<head>`, **Then** `og:title` = nome da edição, `og:description` com data/local, canonical apontando pra própria URL
4. **Given** post do blog, **When** inspeciona o `<head>`, **Then** `og:type=article` com `publishedTime`, tags e canonical
5. **Given** qualquer página, **When** renderiza OG image, **Then** responde imagem com a marca hackahub

---

### User Story 3 - Rich results via dados estruturados (Priority: P2)

Página de edição injeta JSON-LD `Event` (nome, datas, local, organizador, URL) e post injeta JSON-LD `Article` (headline, data, autor, publisher) — elegíveis a rich results do Google.

**Why this priority**: Rich result é diferencial de CTR, mas depende do P1 de metadata já existir.

**Independent Test**: extrair o `script[type="application/ld+json"]` de `/h/[id]` e validar `@type=Event` com `startDate`/`location`/`organizer`; idem `Article` no post.

**Acceptance Scenarios**:

1. **Given** edição presencial, **When** lê o JSON-LD, **Then** `location` é `Place` com o nome do local e `organizer` é `Organization`
2. **Given** post, **When** lê o JSON-LD, **Then** `@type=Article` com `headline`, `datePublished`, `author` e `mainEntityOfPage` = URL do post
3. **Given** conteúdo com `<` no texto, **When** JSON-LD é serializado, **Then** escapa como `\u003c` (sem quebrar o HTML)

---

### Edge Cases

- Post com frontmatter incompleto (sem título/data válida) → build/parse falha com erro claro, não publica quebrado
- Slug malicioso (`../..`) → `getPost` retorna null, nunca lê arquivo fora de `content/blog/`
- Markdown com HTML cru (`<script>`) → renderer escapa; nunca injeta HTML arbitrário
- Link `javascript:` no markdown → renderizado como texto, sem `href`
- Fence de código não fechado → renderiza até o fim sem travar
- `NEXT_PUBLIC_SITE_URL` ausente → fallback `https://hackahub.dev` (placeholder documentado); com a env, canonical/OG/sitemap usam a URL real
- Edição inexistente → `generateMetadata` devolve título neutro e a página 404 normal

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `content/blog/*.md` com frontmatter `title`, `description`, `date` (YYYY-MM-DD), `author`, `tags[]`; parse falha em campo obrigatório ausente
- **FR-002**: `listPosts()` retorna posts ordenados por data desc com `slug`, meta e `excerpt`; `getPost(slug)` retorna meta + HTML renderizado ou null
- **FR-003**: Renderer markdown próprio e mínimo (sem dependência nova): h1–h4, p, ul/ol/li, fenced code, inline code, links http(s)/internos, bold, italic — sempre escapando HTML cru
- **FR-004**: `/blog` pública, lista estilo feed (linhas, não cards); `/blog/[slug]` com tipografia de leitura e link de volta
- **FR-005**: `app/sitemap.ts` cobre rotas estáticas + `/h/[id]` ativas + `/u/[username]` de membros + `/blog/[slug]`; `app/robots.ts` permite tudo e aponta o sitemap
- **FR-006**: `metadataBase` central via `SITE_URL` (env `NEXT_PUBLIC_SITE_URL`, fallback `https://hackahub.dev`); layout com `title.template`, OG defaults e twitter card
- **FR-007**: `generateMetadata`/metadata em `/`, `/radar`, `/feed`, `/membros`, `/blog`, `/blog/[slug]` (article), `/h/[id]` (evento), `/u/[username]`
- **FR-008**: JSON-LD `Event` em `/h/[id]` e `Article` em `/blog/[slug]`, serializados com escape `\u003c`
- **FR-009**: `app/opengraph-image.tsx` gera a imagem OG padrão (fundo escuro, borda accent, HACKAHUB)
- **FR-010**: Header ganha link "blog"

### Key Entities

- **BlogPost (arquivo)**: `content/blog/<slug>.md` — frontmatter + corpo markdown; slug = nome do arquivo
- **Sitemap/Robots**: gerados por `lib/seo.ts` a partir das libs de dados existentes
- **JSON-LD**: `Event` (edição) e `Article` (post) construídos por funções puras em `lib/seo.ts`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `/sitemap.xml` retorna 200 e contém 100% das rotas públicas (estáticas + edições + membros + posts)
- **SC-002**: 100% das páginas públicas têm `og:title`, `og:description` e canonical corretos
- **SC-003**: Rich Results Test do Google reconhece `Event` em `/h/[id]` e `Article` em `/blog/[slug]` sem erro
- **SC-004**: Os 3 posts seed renderizam sem depender de CMS nem banco — editar o `.md` e commitar publica

## Assumptions

- Blog é file-based em v1 — CMS/admin de posts é decisão futura; conteúdo entra via PR/`.md`
- Renderer próprio de ~60 linhas cobre o subconjunto de markdown usado nos posts — não é CommonMark completo
- `NEXT_PUBLIC_SITE_URL` é definida em produção; em dev/preview o placeholder `hackahub.dev` é aceitável (documentado no plan)
- Membros "ativos" = todos os registros em `members` (não há flag de ativo/deletado)
- OG image padrão do site cobre todas as rotas; imagem dinâmica por página é fase 2
