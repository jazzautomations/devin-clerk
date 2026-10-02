# Feature Specification: Páginas de Projeto

**Feature**: `010-project-pages`
**Created**: 2026-10-05
**Status**: Draft
**Input**: Funil Colosseum do PRD — hackathon → projeto → portfólio. O arquivo da edição (`/h/[id]`, spec 003) lista projetos como texto morto; cada projeto precisa de uma URL própria (`/p/[teamId]`) pra ser compartilhado, linkado de perfis e indexado — é a "página do projeto" que vira peça de portfólio verificável, não só uma linha numa lista.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante abre a página de um projeto (Priority: P1)

Alguém que recebeu o link (ou clicou a partir do arquivo da edição) abre `/p/[teamId]` e vê a ficha completa do projeto: título, a edição onde nasceu (com link de volta pro `/h/[id]`), a colocação (1º lugar com tratamento lendário, como no pódio), descrição, links pro repositório e demo gravada, e o time — cada membro linkando pro perfil público `/u/[username]`. Quando o deploy tool (spec 008) tem uma demo `running`, um CTA em destaque leva pra `/demo/[id]/`.

**Why this priority**: É o elo que faltava no funil: sem URL própria, o projeto não pode ser compartilhado nem referenciado — o arquivo vira beco sem saída e o portfólio do membro não tem pra onde apontar.

**Independent Test**: Abrir `/h/hack-inova-unifacens-2026`, clicar no título do projeto "One Day Hospital" e cair em `/p/<id>` com título, edição linkada e descrição — sem login nem outra feature.

**Acceptance Scenarios**:

1. **Given** um time com projeto no arquivo, **When** visitante abre `/p/[teamId]`, **Then** vê título do projeto, nome da edição com link pra `/h/[id]`, colocação e descrição
2. **Given** projeto com `repoUrl`/`demoUrl` cadastrados, **When** a página renderiza, **Then** os links aparecem e abrem em nova aba
3. **Given** projeto com deploy `running`, **When** a página renderiza, **Then** um CTA "demo ao vivo" em destaque aponta pra `/demo/[deployId]/`
4. **Given** time sem projeto cadastrado (ou `teamId` inexistente/não numérico), **When** visitante abre `/p/[teamId]`, **Then** recebe 404 — nunca uma página vazia quebrada

---

### User Story 2 - O arquivo e o perfil linkam pra página do projeto (Priority: P2)

Todo lugar que hoje mostra o título do projeto como texto vira porta de entrada pra `/p/[teamId]`: o pódio e a lista de participantes em `/h/[id]`, e a seção "projetos" em `/u/[username]`. O visitante desce o funil sem voltar pro Google.

**Why this priority**: A página sem link entrando nela é órfã — o valor do P1 só se realiza quando o funil inteiro aponta pra ela.

**Independent Test**: Em `/h/[id]` e em `/u/[username]`, clicar no título de um projeto navega pra `/p/[teamId]` correspondente.

**Acceptance Scenarios**:

1. **Given** o arquivo de uma edição, **When** visitante clica no título do projeto (pódio ou lista), **Then** navega pra `/p/[teamId]` daquele time
2. **Given** o perfil de um membro com projeto vinculado, **When** visitante clica no título do projeto, **Then** navega pra `/p/[teamId]`
3. **Given** um time sem projeto (perfil mostra o nome do time como fallback), **When** renderiza, **Then** NÃO vira link — `/p/[teamId]` daria 404

---

### User Story 3 - Link compartilhado carrega metadata do projeto (Priority: P3)

Quando alguém cola `/p/[teamId]` no Discord/Twitter/LinkedIn, o preview mostra o título do projeto e a descrição — não o nome genérico da plataforma. `generateMetadata` resolve título, descrição e Open Graph a partir do banco.

**Why this priority**: Compartilhamento é o canal de crescimento do arquivo — cada projeto postado é propaganda do hackathon. Depende do P1, mas é só metadata sobre a mesma query.

**Independent Test**: `curl -s /p/<id> | grep og:title` devolve o título do projeto.

**Acceptance Scenarios**:

1. **Given** projeto existente, **When** a página renderiza, **Then** `<title>` e `og:title` são o título do projeto e `og:description` é a descrição (ou fallback honesto com edição + time)
2. **Given** `teamId` inválido, **When** metadata resolve, **Then** não quebra — a página continua 404 limpa

---

### Edge Cases

- `teamId` não numérico (`/p/abc`) ou inexistente: 404, sem query inválida nem erro 500
- Time existe mas `team_projects` não tem linha pra ele: 404 (a página é do projeto, não do time)
- Projeto sem descrição: empty state honesto no lugar do parágrafo
- Time sem membros vinculados: seção do time mostra o nome + empty state, nunca lista vazia silenciosa
- Projeto sem `repoUrl`/`demoUrl`: nenhum link quebrado — só empty state ou nada
- Deploy em qualquer status ≠ `running` (queued/building/failed/stopped/expired): sem CTA de demo ao vivo — linkar demo parada é promessa quebrada (o tombstone já mora em `/demo/[id]`)
- Sem iframe da demo: X-Frame-Options dos apps deployados não é controlado — CTA abre em navegação/nova aba

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/p/[teamId]` DEVE ser server component público (sem auth) que renderiza a ficha do projeto: título, edição (link `/h/[id]`), colocação, descrição, links repo/demo, membros (links `/u/[username]`)
- **FR-002**: A rota DEVE responder 404 quando `teamId` não for inteiro positivo, quando o time não existir, ou quando não houver projeto cadastrado
- **FR-003**: Colocação 1º DEVE usar o token `lendario` (mesmo tratamento do pódio em `/h/[id]`); 2º/3º usam badge neutro; participante (0) não mostra badge de colocação
- **FR-004**: Com deploy `running` do time (via `getLatestDeployForTeam`), DEVE haver CTA proeminente "demo ao vivo" → `/demo/[deployId]/`; em qualquer outro status ou ausência, o CTA não aparece
- **FR-005**: `generateMetadata` DEVE devolver `title` = título do projeto, `description` e `openGraph` coerentes; para projeto inexistente, metadata neutra sem quebrar
- **FR-006**: Em `/h/[id]`, os títulos de projeto do pódio e da lista de participantes DEVEM ser links pra `/p/[teamId]` (diff mínimo — só envolver o título existente)
- **FR-007**: Em `/u/[username]`, o título do projeto DEVE linkar pra `/p/[teamId]` quando o projeto existir; sem projeto, o nome do time continua texto puro
- **FR-008**: Campos opcionais ausentes (descrição, links, membros) DEVEM renderizar empty states honestos — nunca link quebrado nem lacuna silenciosa

### Key Entities

- **Project page** (leitura derivada, nenhuma tabela nova): `teams` + `team_projects` (1:1) + `team_members` + `hackathons` — o `teamId` é a chave pública porque `team_projects.teamId` é PK
- **Deploy** (existente, spec 008): `getLatestDeployForTeam(teamId)` decide o CTA — somente `status = 'running'` gera link pra `/demo/[id]/`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Do arquivo de uma edição ao projeto: ≤ 1 clique (título linkado em 100% dos projetos listados)
- **SC-002**: 100% dos `/p/<id>` inválidos respondem 404 — sem 500 e sem página vazia
- **SC-003**: Todo `/p/<id>` válido emite `og:title` igual ao título do projeto (verificável com curl/grep)
- **SC-004**: Nenhum `<a href>` quebrado renderizado: repo/demo/membros/demo-ao-vivo só aparecem quando o dado existe

## Assumptions

- `teamId` inteiro é o identificador público do projeto (PK de `team_projects`); slug bonito fica pra outra spec se fizer falta
- A página é de **projeto**, não de time — time sem projeto é 404 (o arquivo já lista o time)
- Demo ao vivo é link, não embed — apps deployadas podem mandar `X-Frame-Options: deny`, então iframe não é confiável
- Nenhuma escrita nova: a feature só lê de `teams`, `team_projects`, `team_members`, `hackathons` e `deploys`
- `getProjectByTeamId` mora em `lib/archive.ts` junto das outras queries de arquivo — mesmo padrão das libs existentes
