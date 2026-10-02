# Feature Specification: Busca + OG dinâmico

**Feature**: `023-search-og`
**Created**: 2026-10-02
**Status**: Draft
**Input**: O radar já tem dezenas de eventos raspados, o leaderboard cresce a cada conta e o índice de projetos cruza edições — mas não há como buscar: é scroll ou nada. E quando um link de edição é compartilhado (WhatsApp, Discord, X), o card social é sempre a imagem genérica do site — a edição, que é o produto, não aparece.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante busca no radar, membros e projetos (Priority: P1)

Alguém que procura "hackathon de saúde", um membro pelo username/skill ou um projeto pelo nome digita no campo de busca de `/radar`, `/membros` ou `/projetos` e a lista encolhe pro que interessa — server-side via `?q=`, linkável e compartilhável. Filtros já ativos (formato, sort, edição, só-ao-vivo) sobrevivem à busca.

**Why this priority**: Descoberta é a porta de entrada — sem busca, radar/membros/projetos degradam pra lista infinita a cada seed/scrape. É o que falta pros três índices públicos serem usáveis de verdade.

**Independent Test**: Abrir `/radar?q=saude`, `/membros?q=react` e `/projetos?q=hospital` e ver só resultados que casam — sem login, sem outra feature.

**Acceptance Scenarios**:

1. **Given** visitante em `/radar`, **When** submete a busca "saude", **Then** a URL vira `/radar?q=saude` e só eventos cujo nome, local ou tags casam aparecem
2. **Given** busca sem resultado, **When** a lista renderiza, **Then** empty state honesto aparece (nunca página quebrada nem lista cheia disfarçada)
3. **Given** `/membros?sort=recent` ativo, **When** visitante busca, **Then** o sort sobrevive (input hidden no form) — e os chips de sort preservam o `q`
4. **Given** `/projetos?h=<edicao>&live=1`, **When** visitante busca, **Then** `h` e `live` seguem ativos junto do `q`
5. **Given** termo com curinga SQL (`%`, `_`), **When** busca roda, **Then** casa literal — `%` nunca vira "casa tudo"

---

### User Story 2 - Link de edição compartilhado mostra card da edição (Priority: P2)

Alguém cola `/h/<id>` no Discord/WhatsApp e o preview mostra a edição de verdade: nome grande, data, local e a borda na cor da raridade da carta colecionável — o OG deixa de ser o logo genérico e vira vitrine da edição.

**Why this priority**: Cada edição compartilhada é marketing gratuito; OG genérico desperdiça o momento em que alguém já clicou. Depende do P1? Não — mas vale menos que a busca.

**Independent Test**: `curl -I /h/hack-inova-unifacens-2026/opengraph-image` retorna 200 `image/png`; o HTML de `/h/<id>` aponta `og:image` pra essa rota.

**Acceptance Scenarios**:

1. **Given** edição ativa, **When** crawler pede `/h/[id]/opengraph-image`, **Then** recebe PNG 1200×630 com nome da edição, data, local e marca hackahub
2. **Given** edição com carta lendária, **When** OG renderiza, **Then** a borda usa o hex da raridade (`#f59e0b`); raro `#38bdf8`, épico `#a78bfa`, comum cinza
3. **Given** id inexistente, **When** crawler pede a imagem, **Then** recebe imagem fallback da marca (nunca exception/500 pelada)
4. **Given** página de projeto `/p/[teamId]`, **When** compartilhada, **Then** OG mostra título do projeto + edição + colocação (bônus, mesmo padrão)

---

### Edge Cases

- `?q=` vazio ou só espaços = sem filtro (lista completa, sem estado quebrado)
- Busca é case-insensitive (SQLite LIKE já é pra ASCII; campos JS do radar normalizados com `toLowerCase`)
- Termo com `%`/`_` é literal — escape com `ESCAPE '\'` nas queries LIKE
- Filtros de formato/tag do `HackathonFeed` são client-side e independentes do `?q=` server-side — combinam sem conflito
- Edição inativa/inexistente no OG: fallback da marca, não 404 pelado — scraper nunca deve levar erro
- Campo de busca preserva params ativos via inputs hidden (`sort`, `h`, `live`)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/radar`, `/membros` e `/projetos` DEVEM aceitar `?q=` GET e filtrar server-side: radar por nome/local/tags; membros por username/name/headline/skills; projetos por título/descrição/nome do time
- **FR-002**: Cada página DEVE ter um `<form method="get">` mínimo com input mono `name="q"` mantendo o termo digitado (`defaultValue`)
- **FR-003**: O form DEVE preservar filtros ativos via inputs hidden (`sort` em /membros; `h`/`live` em /projetos); os chips de filtro DEVEM preservar `q`
- **FR-004**: Busca sem match DEVE mostrar empty state claro; `?q=` vazio/só espaços NÃO filtra nada
- **FR-005**: Queries LIKE DEVEM escapar `%` e `_` com `ESCAPE '\'` — curinga do usuário nunca vira coringa SQL
- **FR-006**: `/h/[id]/opengraph-image` DEVE gerar PNG 1200×630: fundo escuro, nome da edição grande, data + local, marca "hackahub", borda no hex da raridade da carta (`getCardRarity`)
- **FR-007**: OG de id inexistente/inativo DEVE responder 200 com imagem fallback da marca
- **FR-008**: `/p/[teamId]/opengraph-image` DEVE seguir o mesmo padrão (título + edição + colocação) — escopo bônus se trivial

### Key Entities

- Nenhuma entidade nova — leitura sobre `hackathons`, `members`, `teams`/`team_projects`, `cards.rarity`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `/radar?q=<termo>` reduz a lista pra matches em 1 request — resposta 200, sem JS obrigatório
- **SC-002**: 100% dos termos com `%`/`_` casam literal (teste unitário cobre o escape)
- **SC-003**: `og:image` de qualquer `/h/<id>` ativo responde 200 `image/png` em <3s de dev
- **SC-004**: Compartilhar `/h/hack-inova-unifacens-2026` mostra nome + data + local da edição no preview (verificável pelo HTML gerado)

## Assumptions

- Busca é substring única (`LIKE %q%` / `includes`) — sem multi-termo, sem ranking de relevância, sem paginação; se achar pouco, é problema de catálogo, não de busca
- Sem debounce/sugestão client-side — form GET nativo é o mínimo que funciona sem JS
- OG usa só inline styles + fonte bundled do `next/og` — nada de assets externos
- Raridade do OG = raridade da carta da edição (`getCardRarity`), não do pódio
