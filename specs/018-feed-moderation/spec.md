# Feature Specification: Moderação do Feed

**Feature**: `018-feed-moderation`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Rede social sem botão de apagar é terra sem lei — cada membro apaga o próprio post ou comentário, e admin apaga qualquer coisa. É a ferramenta mínima de moderação que mantém o `/feed` saudável sem painel novo: o controle mora na própria linha do post/comentário.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Membro apaga o próprio post (Priority: P1)

Membro logado vê um "✕" discreto nos posts que são dele (e só neles). Ao clicar e confirmar, o post some do feed na hora — junto com likes e comentários dele (o conteúdo sai do ar por inteiro, não fica thread órfã). Post dos outros não mostra o controle.

**Why this priority**: Apagar o que é teu é o direito básico do autor — sem isso qualquer post errado vira permanente e o feed acumula lixo que ninguém pode tirar. É o núcleo da feature.

**Independent Test**: Logado como autor, `DELETE /api/posts/[id]` → 200 e o post (com likes/comments) some da listagem; deslogado → 401; em post alheio o botão nem aparece.

**Acceptance Scenarios**:

1. **Given** membro logado num post dele, **When** clica "✕" e confirma, **Then** o post some do feed sem reload e `GET /api/posts` não lista mais
2. **Given** post apagado, **When** alguém consulta, **Then** likes e `post_comments` daquele post não existem mais (cascata completa)
3. **Given** membro logado num post de outra pessoa, **When** olha a linha do post, **Then** NÃO vê o controle de apagar (e a API devolve 403 se chamado na força)
4. **Given** deslogado, **When** DELETE na API, **Then** 401 JSON (nunca redirect)
5. **Given** post inexistente ou id inválido, **When** DELETE autenticado, **Then** 404

---

### User Story 2 - Membro apaga o próprio comentário (Priority: P2)

Membro logado vê "✕" nos comentários dele dentro da thread expandida. Ao confirmar, o comentário some da thread e a contagem do post desce 1. Comentário dos outros não mostra o controle.

**Why this priority**: Escreveu errado, arrependeu — o mesmo direito do post, uma camada abaixo. Depende do P1 (mesma mecânica de permissão) e completa a moderação self-service.

**Independent Test**: Logado como autor do comentário, `DELETE /api/posts/[id]/comments/[commentId]` → 200; contagem cai; stranger → 403.

**Acceptance Scenarios**:

1. **Given** membro logado num comentário dele, **When** confirma o "✕", **Then** o comentário sai da thread e `commentCount` do post decrementa
2. **Given** membro logado em comentário alheio, **When** DELETE na força, **Then** 403 e nada é apagado
3. **Given** commentId inexistente ou que não pertence ao post da URL, **When** DELETE, **Then** 404
4. **Given** deslogado, **When** DELETE, **Then** 401 JSON

---

### User Story 3 - Admin modera qualquer post ou comentário (Priority: P3)

Admin logado vê o "✕" em TODOS os posts e comentários do feed — é a ferramenta de moderação: spam, ofensa, link quebrado saem na hora, sem console nem SQL. A linha do item não mostra badge especial pra ninguém; o controle é o mesmo do autor.

**Why this priority**: É o que fecha o ciclo de moderação — o admin já existe (role), falta o instrumento. Valor incremental sobre P1+P2: mesma UI, permissão maior.

**Independent Test**: Logado como admin, `DELETE /api/posts/[id]` de post alheio → 200 e cascata completa; idem comentário alheio.

**Acceptance Scenarios**:

1. **Given** admin logado num post de outro membro, **When** DELETE, **Then** 200 e o post some com likes/comments
2. **Given** admin logado num comentário alheio, **When** DELETE, **Then** 200
3. **Given** admin logado, **When** olha o feed, **Then** o "✕" aparece em todos os posts e comentários
4. **Given** membro comum (não-admin), **When** tenta apagar post/comentário alheio, **Then** 403

---

### Edge Cases

- Apagar post com likes e comentários de terceiros: tudo some junto (cascata em transação — nunca post sem likes órfãos ou thread fantasma)
- Membro autenticado no Clerk sem linha em `members`: 401 — mesmo fluxo do like/comment
- `id`/`commentId` não-inteiro na URL: 404 (antes de checar permissão)
- Comentário existe mas pertence a outro post: 404 (URL não bate → não encontrado)
- Admin apagando conteúdo de outro admin: permitido (admin modera admin — v1 sem hierarquia de staff)
- Apagar duas vezes / race com outro cliente: segundo DELETE recebe 404, nunca erro de banco
- `xp`/`badges` do autor não são reembolsados em v1 — o que foi ganho fica

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `DELETE /api/posts/[id]` DEVE exigir membro autenticado: deslogado ou sem linha em `members` → 401 JSON
- **FR-002**: DELETE post DEVE permitir autor do post OU membro com `role = 'admin'`; qualquer outro → 403 e nada é apagado
- **FR-003**: Post inexistente ou id não-inteiro → 404; apagar DEVE remover o post + seus likes + seus `post_comments` em uma única transação
- **FR-004**: `DELETE /api/posts/[id]/comments/[commentId]` DEVE seguir as mesmas guards (401/403/404); comentário de outro post → 404
- **FR-005**: DELETE de comentário DEVE permitir autor do comentário OU admin; resposta de sucesso é `{ok: true}` com 200
- **FR-006**: `/feed` e dashboard DEVEM mostrar o controle "✕" apenas onde o viewer tem permissão (autor ou admin); anon e membros comuns não veem o controle em conteúdo alheio
- **FR-007**: Apagar pela UI DEVE pedir confirmação e atualizar a lista local sem reload (post some; comentário some e `commentCount` decrementa)
- **FR-008**: Listagem pública (`GET /api/posts`, GET comments) NÃO muda contrato — leitura continua pública e sem campos novos

### Key Entities

- **Post** (existente): deleção em cascata de `likes` + `post_comments` — nenhuma coluna/tabela nova
- **Comment** (existente): deleção simples por id — `postId` serve só pra validar a URL
- **Member** (existente): `role` decide entre autor-ou-admin; nenhuma permissão nova é criada

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Membro apaga post próprio em 2 cliques (✕ + confirmar) e ele sai do feed em <1s sem reload
- **SC-002**: 100% dos DELETEs autenticados respeitam autor-ou-admin: zero deletes de stranger em produção/teste
- **SC-003**: Apagar um post não deixa linhas órfãs: `likes` e `post_comments` do post zeram na mesma transação
- **SC-004**: Anon continua lendo feed e threads sem ver controle de moderação; API responde 401 JSON sem redirect

## Assumptions

- Sem lixeira/soft-delete em v1 — apagou, sumiu (dado histórico volta por backup se necessário)
- Sem UI de moderação no `/admin` em v1 — a superfície é o próprio feed; painel entra quando o volume pedir
- XP e badges não são reembolsados ao apagar — gamificação não desfaz (decisão pra spec futura se abusarem)
- Confirmação via `confirm()` nativo — fluxo de 2 cliques é suficiente pra ação destrutiva em v1
- `listPosts`/`listComments` não ganham campo `canDelete`: o client deriva de `me`/`isAdmin` (username + role já vêm por props)
