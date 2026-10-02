# Feature Specification: Mural da Edição — feed com escopo de hackathon

**Feature**: `028-edition-feed`
**Created**: 2026-11-24
**Status**: Draft
**Input**: O `/feed` é um rio único e global: demo de sábado, dúvida de sponsor e bastidor de organização se misturam numa linha só. O Eternal do Colosseum (referência em 000-refs-study) mostra o modelo que falta: cada edição tem um stream de atividade próprio — updates durante o evento, demos quando saem. Aqui o post ganha um escopo opcional de edição: `/h/[id]` vira mural ao vivo daquela edição, e o `/feed` global continua agregando tudo — com um chip que diz de qual edição o post veio.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inscrito posta no mural da edição (Priority: P1)

Membro inscrito numa edição abre `/h/[id]` e vê a seção "mural da edição": um composer igual ao do feed, mas o post nasce marcado com a edição. A leitura é pública (quem tá decidindo se inscreve vê a edição viva); escrever é privilégio de inscrito — o mesmo gate do board de times (012) e da submissão de time (021).

**Why this priority**: É o que transforma a página da edição de cartaz estático em lugar onde o evento acontece — sem post escopado não existe mural.

**Independent Test**: Membro inscrito faz `POST /api/posts` com `{body, hackathonId}` → 201 e o post aparece em `GET /api/posts?h=[id]`; não-inscrito recebe 403.

**Acceptance Scenarios**:

1. **Given** membro inscrito na edição, **When** posta com `hackathonId` válido, **Then** recebe 201 com `post.hackathonId` preenchido e `hackathonName` resolvido via join
2. **Given** membro inscrito, **When** posta sem `hackathonId` (ou null/vazio), **Then** o post é global (`hackathonId` NULL) — comportamento atual intacto
3. **Given** membro NÃO inscrito, **When** posta com `hackathonId`, **Then** recebe 403 ("inscreve-te primeiro"); deslogado → 401
4. **Given** qualquer membro, **When** posta com `hackathonId` de edição inexistente, **Then** recebe 404; edição existente mas inativa → 400
5. **Given** edição já encerrada, **When** inscrito posta, **Then** funciona — o mural recebe as demos que saem depois do evento

---

### User Story 2 - Visitante lê o mural na página da edição (Priority: P1)

A página `/h/[id]` ganha a seção "// mural da edição": mesma lista de posts do feed (autor, LV, likes, comentários lazy), filtrada pra edição. Anon e membro não-inscrito leem tudo mas não veem composer — em vez disso um hint de que só inscrito posta.

**Why this priority**: Mural sem leitura pública é grupo fechado; a vitrine da edição é o que convence o próximo inscrito.

**Independent Test**: Anon abre `/h/[id]` com posts escopados seedados → vê os posts e o hint; não vê textarea/composer.

**Acceptance Scenarios**:

1. **Given** edição com posts no mural, **When** qualquer visitante abre `/h/[id]`, **Then** vê a seção com os posts em ordem cronológica reversa
2. **Given** membro inscrito, **When** abre a página, **Then** vê o composer e posta sem sair da página
3. **Given** anon ou membro não-inscrito, **When** abre a página, **Then** não vê composer — só o hint "// só inscritos postam no mural"
4. **Given** edição sem posts, **When** visitante abre a página, **Then** vê o estado vazio do mural

---

### User Story 3 - Post de edição no feed global com chip (Priority: P2)

O `/feed` continua agregando tudo — post de edição não some do rio principal. O que muda: post com `hackathonId` mostra um chip `→ <nome da edição>` linkando `/h/[id]`, dando contexto e tráfego de volta pra página da edição.

**Why this priority**: É a decisão de produto que fecha o loop — mural é filtro, não silo. O feed global é a vitrine; o chip é a porta de volta.

**Independent Test**: Post escopado seedado aparece em `GET /api/posts` (sem `?h=`) com `hackathonId`/`hackathonName` e o card renderiza o chip com href correto.

**Acceptance Scenarios**:

1. **Given** posts globais e escopados, **When** `GET /api/posts` sem parâmetro, **Then** retorna todos (scope omitido = agregado)
2. **Given** post escopado, **When** renderiza no `/feed` ou `/dashboard`, **Then** mostra chip `→ <nome>` linkando `/h/[id]`; post global não mostra chip
3. **Given** `GET /api/posts?h=[id]` de edição válida e ativa, **Then** retorna só posts daquela edição; edição inexistente/inativa → 404 JSON

---

### Edge Cases

- `hackathonId` não-string (número, objeto) no POST → 400
- `hackathonId` vazio/`""`/null → post global, nunca erro (não punir cliente que manda campo opcional)
- Post de edição apagado pela moderação some dos dois lugares (mesma cascata de sempre — `deletePost` inalterado)
- Edição desativada depois de receber posts: o mural morre junto com a página (404), e os posts continuam no `/feed` com o chip (o conteúdo é da comunidade, não da edição)
- `?h=` no GET com edição inexistente ou inativa → 404, mesmo gate do board (`/api/hackathons/[id]/team-board`)
- Likes e comentários em posts escopados funcionam igual — escopo é metadado de exibição/filtro, não de permissão

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `posts.hackathonId TEXT` nullable via `ALTER TABLE` guardado por `PRAGMA table_info` em `lib/posts.ts` (padrão do próprio arquivo; `lib/db.ts` NÃO é tocado). `NULL` = post global — todo post existente migra de graça
- **FR-002**: `listPosts(limit, meId, scope?)` — `scope` omitido retorna TODOS os posts (global + edições); `{ global: true }` filtra `hackathonId IS NULL`; `{ hackathonId }` filtra pela edição. Assinatura anterior continua válida
- **FR-003**: `createPost(memberId, body, link?, hackathonId?)` persiste o escopo; validações de body/link inalteradas (edição é validada na rota, que tem contexto HTTP pra 404/400/403)
- **FR-004**: O SELECT de posts ganha `LEFT JOIN hackathons` expondo `hackathonId` e `hackathonName` em todo post (pra chip e pra resposta do POST)
- **FR-005**: `GET /api/posts?h=[id]` — público; edição inexistente/inativa → 404 JSON; sem `?h=` retorna o agregado (decisão: posts de edição ficam no feed global)
- **FR-006**: `POST /api/posts` com `hackathonId` — 401 deslogado; 404 edição inexistente; 400 edição inativa ou `hackathonId` não-string; 403 membro não inscrito (`"inscreve-te primeiro"` — mesma msg do board); 201 com `post` + XP `post` (+10) + `checkBadges`
- **FR-007**: `FeedSection` aceita `hackathonId?` + `editionLabel?`: quando escopado, o POST envia `hackathonId` no body e o refresh pós-delete refaz `GET /api/posts?h=[id]`; sem as props o componente é byte-a-byte o de hoje (`/feed` e `/dashboard` não mudam)
- **FR-008**: Card de post com `hackathonId` renderiza chip `→ <hackathonName>` (`Link` pra `/h/[id]`); nome ausente cai pro id — nunca quebra o card
- **FR-009**: `/h/[id]` ganha seção "// mural da edição" em diff append-only (após "inscritos", antes do `</section>`); `canPost = member && registered`; leitura sempre pública
- **FR-010**: Zero mudança em likes, comentários, moderação e nas páginas `/feed`/`dashboard` além do chip — backward-compat verificado pelos testes existentes

### Key Entities

- **Post** ganha `hackathonId: string | null` (+ `hackathonName` derivado por join). Escopo é nullable por design: global é o default, edição é o refinamento — nunca o contrário.
- Reusa **hackathons** (id/name/active) e **registrations** (gate de escrita) — sem tabela nova.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Inscrito posta no mural em <30 s a partir da página da edição, sem passar pelo `/feed`
- **SC-002**: 100% dos posts escopados exibem chip com link válido pra `/h/[id]` no feed global
- **SC-003**: Não-inscrito não consegue postar no mural por nenhuma rota (403 garantido por teste de API)
- **SC-004**: `GET /api/posts` sem parâmetro e `/feed` retornam posts globais E de edição — regressão zero nos testes existentes

## Assumptions

- "Inscrito" = linha em `registrations` — mesmo gate do board (012) e da submissão de time (021)
- O mural aceita post depois do encerramento da edição: demo e retro saem nos dias seguintes; o gate é a inscrição, não o calendário
- `/feed` agrega posts de edição (decisão documentada no plan): mural é recorte contextual, não silo — quem quis o rio global continua com ele
- Escopo de leitura não existe: quem pode ver `/feed` pode ver qualquer mural; a permissão nova é só de escrita
- `hackathonId` de edição inativa não vaza existência via GET (404), mas via POST responde 400 honesto — o cliente explicitamente tentou escrever nela
