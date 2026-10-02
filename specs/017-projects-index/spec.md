# Feature Specification: Índice de Projetos

**Feature**: `017-projects-index`
**Created**: 2026-11-03
**Status**: Draft
**Input**: Funil Colosseum do PRD — o Colosseum tem `/companies`, índice público de tudo que já foi construído. Aqui cada projeto já tem página própria (`/p/[teamId]`, spec 010) e o arquivo por edição (`/h/[id]`, spec 003), mas falta a porta de entrada única: `/projetos` lista TUDO que já nasceu nos hackathons, cruzando edições — portfólio público da comunidade inteira, não de uma edição só.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante abre o índice de todos os projetos (Priority: P1)

Alguém que quer ver "o que já nasceu aqui" abre `/projetos` (link no header) e vê um grid de cards: título do projeto linkando pra `/p/[teamId]`, a edição onde nasceu linkando pra `/h/[id]`, o nome do time, badge de colocação quando pódio (1º com tratamento lendário, como em `/p`), link pro repositório quando existe e chip "demo ao vivo" em destaque quando o último deploy do time tá `running`. Vencedores aparecem primeiro; dentro da mesma colocação, edições mais recentes primeiro.

**Why this priority**: É a prova pública agregada — sem o índice, cada projeto só é achável dentro da página da própria edição. O índice transforma o acervo em vitrine: um lugar só pra responder "o que essa comunidade já construiu".

**Independent Test**: Abrir `/projetos` sem login e ver o card do "One Day Hospital" (seed) com badge de 1º lugar, link pra `/p/<id>` funcionando e link de volta pra edição.

**Acceptance Scenarios**:

1. **Given** times com projeto em várias edições, **When** visitante abre `/projetos`, **Then** vê um card por projeto com título (link `/p/[teamId]`), edição (link `/h/[id]`), nome do time e repo quando cadastrado
2. **Given** um time campeão (placement 1), **When** o card renderiza, **Then** mostra badge "1º lugar" com token `lendario`; 2º/3º mostram badge neutro; participante (0) não mostra badge
3. **Given** time cujo último deploy tá `running`, **When** o card renderiza, **Then** chip "demo ao vivo" aponta pra `/demo/[deployId]/`; com último deploy em outro status ou sem deploy, o chip não aparece
4. **Given** time sem projeto cadastrado, **When** o índice renderiza, **Then** o time NÃO aparece — o índice é de projetos, não de times
5. **Given** a lista completa, **When** renderiza, **Then** pódio (1,2,3) vem antes de participantes (0 por último); em empate de colocação, edição mais recente (`startsAt` desc) primeiro

---

### User Story 2 - Visitante filtra por edição ou por "só ao vivo" (Priority: P2)

No topo do índice, chips filtram server-side: um por edição que tem projeto (`?h=<hackathonId>`) e um toggle "só ao vivo" (`?live=1`). Os filtros combinam — dá pra ver "só as demos ao vivo da edição X". Chip ativo fica marcado; clicar no ativo (ou em "todas") limpa o filtro.

**Why this priority**: O índice cresce a cada edição — sem filtro mínimo, vira parede de texto. Edição e "ao vivo" são os dois cortes que respondem "o que rolou naquele evento" e "o que eu posso abrir e testar agora".

**Independent Test**: Abrir `/projetos?h=hack-inova-unifacens-2026` mostra só projetos daquela edição; `?h=edicao-inexistente` mostra empty state; `?live=1` mostra só cards com demo rodando.

**Acceptance Scenarios**:

1. **Given** projetos em edições diferentes, **When** visitante clica o chip de uma edição, **Then** a URL ganha `?h=<id>` e só os cards daquela edição aparecem
2. **Given** filtro `?h` ativo, **When** visitante liga "só ao vivo", **Then** a URL fica `?h=<id>&live=1` e só cards com deploy `running` daquela edição aparecem
3. **Given** `?h` com id inexistente ou sem projetos, **When** a página renderiza, **Then** responde 200 com empty state honesto — nunca 404 nem 500

---

### User Story 3 - O índice é achável e indexável (Priority: P3)

`/projetos` entra no sitemap, emite `<link rel="canonical">` e tem link "projetos" no header — visitante e crawler chegam sem conhecer a URL.

**Why this priority**: Índice órfão não cumpre o papel de vitrine; depende do P1 mas é só wiring.

**Independent Test**: `curl -s /projetos | grep canonical` devolve `/projetos`; `/sitemap.xml` inclui a rota; header de qualquer página tem link pra ela.

**Acceptance Scenarios**:

1. **Given** qualquer página do app, **When** renderiza o header, **Then** existe link "projetos" → `/projetos`
2. **Given** o sitemap, **When** `buildSitemap()` roda, **Then** inclui `SITE_URL/projetos`
3. **Given** a página, **When** metadata resolve, **Then** canonical é `/projetos` e título descreve o índice

---

### Edge Cases

- Time com `team_projects` ausente: fora do índice (join interno) — o índice é de projetos entregues
- `?h` com id inexistente, `?live` com valor arbitrário: página responde 200 normal, filtro inválido simplesmente não casa nada (ou liga, no caso de `live` presente)
- Projeto sem `repoUrl`: card renderiza sem o link de repo — nunca link quebrado
- Último deploy `queued`/`building`/`failed`/`stopped`/`expired`: sem chip — só `running` conta (mesma regra de `/p/[teamId]`)
- Time sem membros vinculados: card mostra o time normalmente, sem contador mentiroso
- Índice vazio (nenhum projeto em nenhuma edição, ou filtro sem resultado): empty state honesto, nunca página quebrada

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/projetos` DEVE ser server component público (sem auth) que lista todo time COM projeto — `teams` ⋈ `team_projects` ⋈ `hackathons` (join interno), um card por projeto
- **FR-002**: A ordenação DEVE ser colocação ascendente com participantes (placement=0) por último; desempate por `startsAt` da edição descendente
- **FR-003**: Cada card DEVE mostrar título do projeto (link `/p/[teamId]`), nome da edição (link `/h/[id]`), nome do time e contagem de membros vinculados; repo como link externo quando `repoUrl` existe
- **FR-004**: Badge de colocação aparece só pra 1º/2º/3º — 1º usa token `lendario` (mesmo tratamento de `/p/[teamId]` e `/membros`), 2º/3º neutros; placement 0 sem badge
- **FR-005**: Card DEVE exibir chip "demo ao vivo" → `/demo/[deployId]/` somente quando o ÚLTIMO deploy do time (mesma fonte de `getLatestDeployForTeam`) está `running`
- **FR-006**: Filtros via `searchParams`: `?h=<hackathonId>` restringe a uma edição; `?live=1` restringe a projetos com demo `running`; combináveis; chips marcam o estado ativo
- **FR-007**: Metadata da página DEVE ter `title`, `description` e `alternates.canonical` = `/projetos`; a rota DEVE constar no sitemap e no header
- **FR-008**: Filtro sem resultado e índice vazio DEVEM renderizar empty state honesto — nunca erro nem lista silenciosamente vazia

### Key Entities

- **Project card** (leitura derivada, nenhuma tabela nova): `teams` + `team_projects` (INNER) + `hackathons` + contagem de `team_members` + último `deploys` por time
- Reusa tipos e funções existentes: `TeamProject`/`createTeam` de `lib/archive.ts`, `getLatestDeployForTeam` de `lib/deploys.ts`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Qualquer projeto entregue é alcançável em ≤2 cliques a partir do header (header → `/projetos` → `/p/[teamId]`)
- **SC-002**: 100% dos cards com último deploy `running` exibem chip "demo ao vivo"; 0% dos demais exibem
- **SC-003**: `?h` inválido ou sem projetos responde 200 com empty state — sem 404/500
- **SC-004**: `/projetos` aparece em `/sitemap.xml` e a página emite canonical correto (verificável com curl/grep)

## Assumptions

- O índice é de **projetos**, não de times — time sem projeto não aparece (o arquivo da edição já o lista como participante)
- `?h` filtra por `hackathonId` literal (o id público das rotas `/h/[id]`); id desconhecido = lista vazia, não erro
- O chip "demo ao vivo" replica a regra de `/p/[teamId]`: último deploy do time em `running` — deploy antigo `stopped` sob um mais novo não ressuscita o chip
- "N é pequeno": o índice cobre todas as edições arquivadas — leitura por linha pro deploy (mesma função do `/p`) é aceitável e mantém a regra em um lugar só
- Nenhuma escrita nova: a feature só lê de `teams`, `team_projects`, `team_members`, `hackathons` e `deploys`
