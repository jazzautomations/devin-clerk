# Feature Specification: Feed de Hackathons

**Feature Branch**: `001-hackathon-feed`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Feed curado de hackathons no dashboard de membros: eventos do Brasil e do mundo com nome, organizador, data, formato, local, link de inscrição, deadline e tags. Primeira feature real do roadmap — remove 'Feed de hackathons' de upcomingFeatures e vira a tela principal do dashboard."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Membro descobre hackathons abertos (Priority: P1)

Um membro logado abre o dashboard e vê uma lista de hackathons futuros,
ordenados pela data mais próxima. Cada item mostra o essencial pra decidir se
vale a pena: nome, organizador, data, formato (online/presencial/híbrido),
cidade/país, deadline de inscrição e um link pro cadastro oficial.

**Why this priority**: É a promessa central do produto — sem feed, o dashboard
é um cartão de "coming soon" sem utilidade. Sozinha, essa story já entrega
valor: o membro passa a voltar na plataforma pra ver o que tá rolando.

**Independent Test**: Logar → abrir `/dashboard` → ver ≥1 hackathon real
cadastrado → clicar no link de inscrição e cair na página oficial do evento.

**Acceptance Scenarios**:

1. **Given** membro logado e feed com eventos futuros, **When** abre
   `/dashboard`, **Then** vê os eventos em ordem de data crescente com todos
   os campos visíveis.
2. **Given** membro logado, **When** clica no link de inscrição de um evento,
   **Then** é levado à URL oficial do evento em nova aba.
3. **Given** feed vazio (sem eventos cadastrados), **When** membro abre o
   dashboard, **Then** vê um estado vazio informativo ("nenhum hackathon
   aberto no momento"), não uma tela quebrada.

---

### User Story 2 - Membro filtra o feed (Priority: P2)

O membro filtra a lista por formato (online / presencial / híbrido) e por tag
(ex.: IA, web3, saúde) pra achar só o que interessa.

**Why this priority**: Com poucos eventos a lista completa já resolve; filtros
ganham valor conforme o feed cresce. P2 porque não bloqueia o MVP.

**Independent Test**: Cadastrar eventos com formatos/tags diferentes → filtrar
por "online" → só eventos online aparecem.

**Acceptance Scenarios**:

1. **Given** feed com eventos de formatos mistos, **When** membro seleciona
   "online", **Then** só eventos online são exibidos.
2. **Given** filtro ativo sem resultados, **When** a lista fica vazia,
   **Then** estado vazio informa que o filtro não retornou nada e oferece
   limpar filtros.

---

### User Story 3 - Admin cura o feed (Priority: P3)

Um admin cadastra/edita eventos sem deploy: nome, organizador, datas, formato,
local, URL de inscrição, deadline e tags. Eventos passados ou cancelados saem
da listagem automaticamente (por data) ou manualmente.

**Why this priority**: A curadoria é o diferencial do produto, mas pro MVP o
admin pode ser só "quem tem acesso ao banco/arquivo" — não precisa de UI de
admin. P3 porque pode começar com dados seedados.

**Independent Test**: Inserir um evento novo na fonte de dados → recarregar
`/dashboard` → evento aparece na posição correta da ordenação.

**Acceptance Scenarios**:

1. **Given** um evento cadastrado com data futura, **When** membro abre o
   feed, **Then** o evento aparece.
2. **Given** um evento cuja data já passou, **When** membro abre o feed,
   **Then** o evento não aparece na lista de "próximos".

---

### Edge Cases

- Evento sem deadline de inscrição definido → mostrar "inscrições abertas" em
  vez de data vazia.
- Evento online sem cidade → não mostrar localidade vazia; "Online" basta.
- Deadline de inscrição já encerrado mas evento futuro → marcar como
  "inscrições encerradas" e desabilitar/diminuir o destaque do link.
- Lista longa (>20 eventos) → paginação ou scroll infinito; MVP pode aceitar
  lista única se o volume real for baixo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST exibir, somente pra membros autenticados, uma
  lista de hackathons futuros em `/dashboard`, ordenada por data crescente.
- **FR-002**: Cada item MUST mostrar: nome, organizador, data de início,
  formato (online/presencial/híbrido), localidade, link de inscrição externo,
  deadline de inscrição e tags.
- **FR-003**: Eventos com data de início no passado MUST NOT aparecer na lista
  principal.
- **FR-004**: O membro MUST poder filtrar por formato e por tag.
- **FR-005**: O link de inscrição MUST abrir a URL oficial do evento em nova
  aba (rel="noopener").
- **FR-006**: Feed vazio MUST renderizar um estado vazio informativo.
- **FR-007**: Eventos com deadline encerrado MUST ser sinalizados como
  "inscrições encerradas".
- **FR-008**: A rota `/api/roadmap` MUST seguir retornando 401 deslogado; a
  lista de hackathons NÃO é pública nessa versão.
- **FR-009**: Admins MUST poder cadastrar eventos por uma fonte de dados
  editável (arquivo seed ou tabela) sem alterar código de UI.

### Key Entities

- **Hackathon**: nome, organizador, data de início, data de fim, formato,
  localidade (cidade/país ou null pra online), url de inscrição, deadline de
  inscrição (nullable), tags (lista), ativo/cancelado.
- **Membro** (já existe via Clerk): identidade do usuário logado; nessa
  feature só gate de acesso, sem dados novos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Membro logado vê a lista de hackathons em menos de 2 segundos
  após abrir o dashboard.
- **SC-002**: 100% dos eventos exibidos são futuros e têm link de inscrição
  clicável que abre a página oficial.
- **SC-003**: Membro encontra um evento relevante (via lista ou filtro) em
  menos de 30 segundos.
- **SC-004**: Pelo menos 5 hackathons reais cadastrados no lançamento
  (curadoria inicial da comunidade).

## Assumptions

- Curadoria é manual no MVP — sem crawler de Devpost/MLH; fonte de dados é
  seed editável (arquivo ou tabela Postgres simples).
- UI de admin fica fora do escopo; cadastro é por dados, não por tela.
- "Inscrição em 1 clique" é feature separada do roadmap — aqui o link leva ao
  cadastro oficial externo.
- Feed é members-only nessa versão; uma vitrine pública de eventos pode vir
  depois como top de funil.
