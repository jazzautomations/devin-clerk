# Feature Specification: Desafios Patrocinados

**Feature**: `006-sponsored-challenges`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Monetização #1 do PRD — "desafios patrocinados: empresa posta desafio/vaga pra quem se destaca". Princípio inegociável: **participante nunca paga** — a receita vem de patrocinadores e empresas que lançam desafios nas edições. O nome/logo do sponsor na página da edição É o inventário que se vende.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante vê os desafios da edição com a marca do sponsor (Priority: P1)

Quem abre `/h/[id]` de uma edição vê a seção "desafios patrocinados": cada desafio mostra a marca do patrocinador em destaque, o título do desafio, o prêmio e a descrição. É a prova pública de que empresas reais colocaram dinheiro/recursos na edição — e é o slot de mídia que o HackaHub vende.

**Why this priority**: É a primeira superfície de monetização da plataforma. Sem renderização pública, o cadastro admin não vale nada — o que se vende é a presença da marca na página.

**Independent Test**: Abrir `/h/hack-inova-puc-saude-2026` e ver "Oracle" como sponsor do desafio "Jornada do paciente" com o prêmio destacado — sem login, sem outra feature.

**Acceptance Scenarios**:

1. **Given** edição com desafios ativos cadastrados, **When** visitante abre `/h/[id]`, **Then** vê seção de desafios com sponsor em destaque, título, prêmio e descrição
2. **Given** desafio com prêmio cadastrado, **When** renderiza, **Then** o prêmio aparece com destaque visual próprio (acento lendário — é o que motiva o hacker)
3. **Given** edição sem desafios, **When** visitante abre a página, **Then** a seção não aparece (nunca empty state que entrega inventário vazio)
4. **Given** desafio desativado pelo admin, **When** visitante abre a página, **Then** ele não aparece mais

---

### User Story 2 - Organizador cadastra e gere desafios via admin (Priority: P2)

O organizador abre a edição no `/admin`, cadastra desafio com sponsor, título, descrição e prêmio; depois pode editar ou desativar. Fluxo de 1 minuto, sem rebuild — o desafio aparece na página pública na hora.

**Why this priority**: Sem entrada de dados o inventário não se preenche — mas o P1 já se demonstra com os seeds reais (Oracle na PUC e na Unifacens).

**Independent Test**: Logado como admin, POST cria desafio e a página pública reflete; PATCH desativa e ele some; não-admin → 403, deslogado → 401, edição inexistente → 404.

**Acceptance Scenarios**:

1. **Given** admin logado, **When** POST `{sponsor, title, description, prize}` na edição, **Then** recebe 201 e o desafio aparece em `/h/[id]`
2. **Given** admin logado, **When** PATCH no desafio com `active: false`, **Then** ele sai da página pública sem ser apagado
3. **Given** não-admin logado, **When** chama POST/PATCH de desafios, **Then** recebe 403
4. **Given** deslogado, **When** chama as APIs, **Then** recebe 401 JSON
5. **Given** body sem sponsor ou title, **When** POST, **Then** recebe 400

---

### User Story 3 - Marca descobre que pode lançar desafio (Priority: P3)

Uma empresa lendo a landing entende que pode patrocinar: uma linha discreta aponta que "sua marca pode lançar um desafio" numa edição — link pra uma página real que mostra o inventário funcionando (edição com desafio patrocinado vivo).

**Why this priority**: É a porta de entrada comercial — uma linha basta pra começar a conversa; landing continua enxuta.

**Independent Test**: Landing `/` tem uma linha sobre desafio patrocinado que leva a uma página onde o inventário é visível.

**Acceptance Scenarios**:

1. **Given** visitante na landing, **When** lê até o fim, **Then** encontra a linha de sponsorship com link pra uma edição com desafio real

---

### Edge Cases

- Desafio sem descrição ou sem prêmio: renderiza sem o campo ausente, nunca quebra
- Desafio desativado permanece no banco (dado histórico/contratual) — `active=0`, não DELETE
- Edição arquivada mantém seus desafios visíveis no arquivo público — sponsor na página é parte do histórico vendido
- Sponsor é texto livre ("Oracle + Enterprise X Ventures") — v1 não tem entidade `sponsors` própria

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada edição (`/h/[id]`) DEVE renderizar seção "desafios patrocinados" quando houver ≥1 desafio ativo, com sponsor em destaque, título, prêmio destacado e descrição
- **FR-002**: Admin DEVE poder criar desafio por edição via `POST /api/admin/hackathons/[id]/challenges` com `{sponsor, title, description?, prize?}` → 201; não-admin → 403, deslogado → 401, edição inexistente → 404, sponsor/title vazios → 400
- **FR-003**: Admin DEVE poder editar/desativar via `PATCH /api/admin/challenges/[challengeId]` — campos `sponsor`, `title`, `description`, `prize`, `active`; desafio inexistente → 404, body vazio → 400
- **FR-004**: Desafios desativados NÃO aparecem na página pública mas permanecem no banco
- **FR-005**: Todos os dados DEVEM persistir no SQLite e sobreviver a restart (migração idempotente)
- **FR-006**: Landing DEVE ter uma linha sobre sponsorship de desafios linkando pra página com inventário real

### Key Entities

- **Challenge**: pertence a uma edição — `sponsor` (marca pagante, texto livre), `title`, `description`, `prize` (ex.: "R$5k + créditos OCI"), `active`, `createdAt`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: As 2 edições com patrocínio real (PUC → Oracle; Unifacens → Oracle + Enterprise X Ventures) exibem seus desafios com marca e prêmio
- **SC-002**: Organizador cadastra um desafio completo em <1 minuto via `/admin`
- **SC-003**: 100% dos desafios sobrevivem a restart; desativar é reversível (nunca perde o registro)
- **SC-004**: Visitante identifica quem patrocinou a edição em <5 segundos na página (marca legível sem scroll excessivo)

## Assumptions

- Sponsor é nome textual — logo upload e entidade `sponsors` (com contratos, contatos) ficam pra fase seguinte
- Prêmio é texto livre — não há catálogo de prêmios nem fulfillment dentro da plataforma
- Participante nunca paga: nada nesta feature cobra hacker — desafio é conteúdo público da edição
- Seeds cobrem o que é público e real (Oracle nas edições PUC e Unifacens); demais desafios entram pelo admin
