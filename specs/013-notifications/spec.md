# Feature Specification: Notificações

**Feature**: `013-notifications`
**Created**: 2026-10-02
**Status**: Draft
**Input**: A rede social já tem curtida e comentário gerando XP — mas quem recebe a interação nunca fica sabendo. Sino no header com badge de não-lidas fecha o loop de feedback: "@x curtiu teu post", "@x comentou no teu post". É o que traz o membro de volta pra plataforma.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Membro descobre que interagiram com ele (Priority: P1)

Membro logado vê um sino (◈) no header com um badge numérico na cor accent quando tem notificações não lidas. Clica no sino, abre um dropdown com as notificações recentes — texto ("@ana curtiu teu post"), tempo relativo e ponto de não-lida. Cada item leva pro contexto (`/feed`). Um botão "marcar tudo lido" zera o badge.

**Why this priority**: Sem notificação, curtir/comentar é gritar no vazio — o autor do post não volta pra ver a reação. É a retenção da rede social.

**Independent Test**: Seed de notificação no banco + login → badge aparece no header; clique abre a lista; "marcar tudo lido" zera a contagem.

**Acceptance Scenarios**:

1. **Given** membro logado com 2 notificações não lidas, **When** abre qualquer página, **Then** o sino mostra badge "2"
2. **Given** dropdown aberto, **When** membro clica numa notificação, **Then** navega pro `href` dela
3. **Given** dropdown aberto, **When** membro clica "marcar tudo lido", **Then** badge zera e os pontos de não-lida somem
4. **Given** membro sem notificações, **When** abre o dropdown, **Then** vê empty state honesto ("nenhuma notificação"), nunca lista quebrada

---

### User Story 2 - Interação no feed gera notificação pro autor (Priority: P1)

Quando alguém curte ou comenta um post, o autor do post recebe notificação — "@x curtiu teu post" / "@x comentou no teu post" — mesmo que nunca abra o post de novo. Quem age em si mesmo não se notifica.

**Why this priority**: É a fonte das notificações — sem gatilho o sino fica vazio pra sempre.

**Independent Test**: Membro A posta; membro B curte/comenta via API → `GET /api/notifications` de A lista as duas. A curtindo o próprio post não gera nada.

**Acceptance Scenarios**:

1. **Given** post de A, **When** B curte via `POST /api/posts/[id]/like`, **Then** A ganha notificação "like" com `actorUsername` de B
2. **Given** post de A, **When** B comenta via `POST /api/posts/[id]/comments`, **Then** A ganha notificação "comment"
3. **Given** post de A, **When** o próprio A curte/comenta, **Then** nenhuma notificação é criada (self-skip)
4. **Given** B descurte o post (unlike), **When** o toggle roda, **Then** nenhuma notificação nova aparece

---

### User Story 3 - API respeita auth e escopo (Priority: P1)

`GET /api/notifications` devolve `{notifications, unread}` só do membro logado — ninguém lê a caixa dos outros. `POST` marca leitura (`readAll` ou `{id}`). Deslogado recebe `401` JSON, nunca redirect.

**Why this priority**: Notificação é dado privado — a guarda é inegociável e testável sem browser.

**Independent Test**: `curl` sem sessão → 401; com membro A seedado, GET só retorna linhas de A; `markRead` com id de outro membro não faz nada.

**Acceptance Scenarios**:

1. **Given** deslogado, **When** `GET /api/notifications`, **Then** `401` JSON
2. **Given** A e B com notificações, **When** A chama GET, **Then** só vê as suas
3. **Given** id de notificação de B, **When** A chama `POST {id}`, **Then** a linha de B segue não lida (escopo por memberId)
4. **Given** body inválido, **When** POST, **Then** `400`

---

### Edge Cases

- Notificação não se apaga ao ler — histórico fica no dropdown (lida ≠ sumiu)
- Sino só existe pra logado — visitante nunca vê o ícone nem o badge
- `actorUsername` é texto congelado: se o ator mudar de username, a notificação antiga segue correta como recado
- Limite de 50 por leitura — volume alto fica pra paginação futura, não pro v1

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/posts/[id]/like` DEVE notificar o autor do post quando o toggle resulta em like (não em unlike)
- **FR-002**: `POST /api/posts/[id]/comments` DEVE notificar o autor do post quando o comentário é criado
- **FR-003**: Nenhuma notificação DEVE ser criada quando ator == alvo (self-skip por username)
- **FR-004**: `GET /api/notifications` DEVE retornar `{notifications[], unread}` do membro logado, mais recente primeiro, limite 50; 401 deslogado
- **FR-005**: `POST /api/notifications` DEVE aceitar `{action:"readAll"}` (marca todas do membro) ou `{id}` (marca uma, escopo por memberId); 400 body inválido; 401 deslogado
- **FR-006**: O header DEVE exibir sino com badge de não-lidas apenas pra membro logado; visitante não vê nada
- **FR-007**: O dropdown DEVE listar texto, tempo relativo e indicador de não-lida por item, com ação "marcar tudo lido"
- **FR-008**: Dados DEVEM persistir no SQLite e sobreviver a restart

### Key Entities

- **Notification**: `id`, `memberId` (destinatário), `actorUsername` (quem agiu, opcional), `type` (`like`/`comment`/…), `text` (recado pronto), `href` (destino do clique), `read` (0/1), `createdAt`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Autor de post descobre curtida/comentário em ≤1 fetch (badge no próximo render de página)
- **SC-002**: 100% das ações like/comment cobertas por teste (incluindo self-skip e unlike)
- **SC-003**: Caixa de um membro nunca vaza pra outro — escopo por memberId em todas as leituras/escritas
- **SC-004**: Zero notificações pra visitante deslogado — nem ícone, nem API

## Assumptions

- v1 cobre só gatilhos like + comment; register/admin/follower ficam pra specs futuras
- Tempo relativo é calculado no client a partir do `createdAt` UTC do SQLite
- Dropdown é client island (`fetch` no mount + refetch ao abrir) — sem polling em v1
- `href` aponta pro `/feed` inteiro (sem âncora por post) — simples e suficiente no fluxo atual
