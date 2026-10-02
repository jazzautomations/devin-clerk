# Feature Specification: Comentários no Feed

**Feature**: `011-post-comments`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Rede social de verdade é conversa — posts do `/feed` ganham thread de comentários pública pra leitura, autenticada pra escrever. Membro comenta → +5 XP. É o ciclo de feedback que transforma post em comunidade.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante lê a conversa de um post (Priority: P1)

Qualquer pessoa (logada ou não) abre `/feed` e vê em cada post a contagem de comentários. Ao expandir a thread, lê a conversa em ordem cronológica (mais antigo primeiro) com autor identificado: `@username` com link pro perfil público, chip de nível (LV) e chip de persona quando existir. Comentário é conteúdo público — a conversa é vitrine do que a comunidade constrói junto.

**Why this priority**: Sem leitura pública o comentário é privado disfarçado — a prova social de que posts geram discussão é o que convence visitante a criar conta. É o núcleo da feature.

**Independent Test**: Abrir `/feed` deslogado num post com comentários e ler a thread completa sem login nem outra feature.

**Acceptance Scenarios**:

1. **Given** um post com 3 comentários, **When** visitante abre `/feed`, **Then** o post mostra a contagem "3 comentários" e ao expandir os 3 aparecem em ordem cronológica
2. **Given** cada comentário, **When** renderiza, **Then** mostra `@username` (link `/u/[username]`), chip LV e chip de persona do autor
3. **Given** post sem comentários, **When** visitante olha o post, **Then** a contagem mostra "0 comentários" e expandir mostra thread vazia sem quebrar
4. **Given** visitante deslogado, **When** expande a thread, **Then** NÃO vê caixa de texto pra comentar (ler é público, escrever é de membro)

---

### User Story 2 - Membro comenta e ganha XP (Priority: P2)

Membro logado vê o composer de comentário na thread de qualquer post, escreve até 1000 caracteres e publica. O comentário aparece na hora no fim da thread, a contagem do post sobe +1 e o membro recebe +5 XP de comentarista. Depois do XP, os badges do membro são reavaliados (fluxo padrão de gamificação).

**Why this priority**: Escrita é o que fecha o ciclo — mas depende do P1 (thread existir) e só faz sentido com a recompensa de XP que alimenta o leaderboard.

**Independent Test**: Logado, POST em `/api/posts/[id]/comments` com `{body}` → 201, comentário listado no GET, XP do membro +5.

**Acceptance Scenarios**:

1. **Given** membro logado num post existente, **When** envia comentário válido (1–1000 chars após trim), **Then** recebe 201 com o comentário criado e o autor identificado
2. **Given** membro que comenta, **When** a API responde 201, **Then** o `xp` do membro subiu +5 e `checkBadges` rodou (sem badge nova de "criador" — comentário não conta como post)
3. **Given** body vazio, só espaços ou >1000 chars, **When** POST, **Then** 400 e nada persiste
4. **Given** post inexistente ou id inválido, **When** POST, **Then** 404
5. **Given** deslogado, **When** POST, **Then** 401 JSON (nunca redirect)

---

### User Story 3 - A contagem acompanha o post em toda listagem (Priority: P3)

A listagem de posts (`GET /api/posts` e o render do `/feed`) carrega `commentCount` por post — sem N+1. Post recém-criado começa com 0; cada comentário novo incrementa.

**Why this priority**: É o detalhe que mantém a UI consistente — contagem vem do servidor, não de soma client-side. Valor incremental sobre P1+P2.

**Independent Test**: `GET /api/posts` retorna `commentCount` correto por post; comentar e re-listar incrementa.

**Acceptance Scenarios**:

1. **Given** posts com contagens diferentes, **When** `GET /api/posts`, **Then** cada post traz `commentCount` batendo com o total real
2. **Given** post criado agora via POST `/api/posts`, **Then** resposta já traz `commentCount: 0`

---

### Edge Cases

- Body com espaços em volta: trim antes de validar e persistir (comentário salvo sem bordas)
- Body com exatamente 1000 chars após trim: aceito
- Membro autenticado no Clerk sem linha em `members` (nunca entrou no feed): 401 — comentar exige membro provisionado, mesmo fluxo do like
- Post apagado no futuro: comentários somem junto (FK `REFERENCES posts(id)`)
- Comentário de autor sem `name`: renderiza `@username` puro — nunca campo vazio
- Dois comentários no mesmo segundo: ordem determinística (createdAt, depois id)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /api/posts/[id]/comments` DEVE ser público e retornar comentários do post em ordem cronológica ascendente, cada um com dados do autor (username, name, persona, xp)
- **FR-002**: `POST /api/posts/[id]/comments` DEVE exigir membro autenticado: deslogado ou sem linha em `members` → 401 JSON
- **FR-003**: POST DEVE validar `body` string com 1–1000 chars após trim: inválido → 400, nada persiste
- **FR-004**: Post inexistente ou id não-inteiro DEVE retornar 404 (GET e POST)
- **FR-005**: Comentário criado DEVE conceder +5 XP ao autor (`XP.comment`) e rodar `checkBadges` em seguida — comentários NÃO contam pra badges de contagem de posts
- **FR-006**: `listPosts`/`GET /api/posts` DEVE incluir `commentCount` por post via subselect (sem N+1)
- **FR-007**: `/feed` DEVE mostrar a contagem e thread expansível por post; composer visível só pra membro logado; leitura sempre pública
- **FR-008**: Comentários DEVEM persistir no banco e sobreviver a restart

### Key Entities

- **Comment**: `postId` → posts, `memberId` → members, `body` (1–1000), `createdAt`
- **Post** (existente): ganha `commentCount` derivado — nenhuma coluna nova em `posts`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Visitante lê qualquer thread de comentários sem login em 100% dos posts
- **SC-002**: Membro publica comentário e vê ele na thread em <1s (resposta 201 já renderizável)
- **SC-003**: XP de comentário reflete no próximo `levelFor`/leaderboard sem intervenção manual
- **SC-004**: Listagem de 50 posts inclui contagens em uma única query (subselect, zero N+1)

## Assumptions

- Sem edição/exclusão de comentário em v1 — moderação entra quando a comunidade pedir
- Sem paginação de thread em v1: posts são curtos e volume inicial é baixo; paginação é spec futura
- Composer usa limite de 1000 chars (post usa 500 — comentário pode ser um pouco maior, nunca um post inteiro)
- XP de comentário vale pro autor do comentário; autor do post não ganha XP por comentário recebido (diferente de like, que recompensa o autor do post — decisão pra spec futura)
