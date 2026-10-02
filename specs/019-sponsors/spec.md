# Feature Specification: Sponsors — CRM de marcas

**Feature**: `019-sponsors`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Evolução da monetização (spec 006). Hoje `challenges.sponsor` é um texto livre — não existe entidade marca. O funil comercial do PRD precisa de CRM: sponsors são entidades com url, tier (apoio/sponsor/master) e contato, vinculadas aos desafios das edições. O campo `sponsor` TEXT permanece como nome de exibição/fallback. Participante nunca paga — quem paga é a marca.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante vê a marca do sponsor como link com tier (Priority: P1)

Quem abre `/h/[id]` e vê a seção "desafios patrocinados" agora vê o sponsor como marca real: nome linkando pro site da empresa e um chip de tier que comunica o nível do patrocínio ("master" em acento lendário, "sponsor" em acento, "apoio" discreto). Desafio sem vínculo continua mostrando o nome textual — nada quebra.

**Why this priority**: É a mesma superfície de venda do 006, agora com camada de valor: o tier diferencia o inventário (master paga mais) e o link prova que a marca é real. Sem renderização pública, o CRM não vale nada.

**Independent Test**: Seedar sponsor "Oracle" com url+tier e vincular a um desafio; abrir `/h/[id]` anon e clicar no nome do sponsor — abre o site da marca — com o chip de tier ao lado.

**Acceptance Scenarios**:

1. **Given** desafio vinculado a sponsor com url+tier, **When** visitante abre `/h/[id]`, **Then** o nome do sponsor é um link externo pro site da marca com um chip de tier ao lado
2. **Given** sponsor com tier "master", **When** renderiza, **Then** o chip usa acento lendário (mesmo token do prêmio/1º lugar)
3. **Given** desafio sem `sponsorId` (só `sponsor` TEXT), **When** visitante abre a página, **Then** o nome aparece como texto puro, sem link nem chip — fallback intacto
4. **Given** sponsor desativado pelo admin, **When** a edição renderiza, **Then** o desafio continua mostrando o vínculo (dado histórico/contratual)

---

### User Story 2 - Organizador gere sponsors e vincula desafios via admin (Priority: P2)

O organizador abre `/admin`, cadastra a marca uma vez (nome, url, tier, contato) e depois a reutiliza em quantos desafios quiser — sem redigitar "Oracle + Enterprise X Ventures" em cada edição. Pode desativar sem apagar (contrato encerrado ≠ histórico apagado).

**Why this priority**: Sem cadastro o CRM não se preenche — mas o P1 já demonstra o render com dados seedados.

**Independent Test**: Logado como admin, POST cria sponsor e GET lista; PATCH desativa; desafio criado/patchado com `sponsorId` sai vinculado. Não-admin → 403, deslogado → 401, sponsor inexistente → 400/404.

**Acceptance Scenarios**:

1. **Given** admin logado, **When** POST `{name, url?, tier?, contactEmail?}` em `/api/admin/sponsors`, **Then** recebe 201 com o sponsor criado
2. **Given** nome já cadastrado ou tier fora de apoio/sponsor/master, **When** POST, **Then** recebe 400
3. **Given** admin logado, **When** PATCH com `active: false`, **Then** o sponsor sai da operação sem ser apagado e os desafios vinculados continuam exibindo
4. **Given** admin, **When** POST de desafio com `sponsorId` válido, **Then** o desafio vincula e (sem `sponsor` textual) assume o nome da entidade como display
5. **Given** `sponsorId` inexistente, **When** POST/PATCH de desafio, **Then** recebe 400 — vínculo nunca fica apontando pro vazio
6. **Given** não-admin logado, **When** chama as APIs de sponsors, **Then** recebe 403; deslogado → 401 JSON

---

### Edge Cases

- Nome de sponsor é único (case-sensitive do banco) — duplicata → 400, não cria segundo registro
- `sponsor` TEXT continua obrigatório por desafio: com `sponsorId` e sem texto, copia-se o nome da entidade; sem nenhum dos dois → 400
- Sponsor desativado NÃO desvincula desafios — histórico vendido permanece renderizando
- `PATCH` com `sponsorId: null` desvincula o desafio (o nome textual permanece como fallback)
- Desafio legado (só texto) e desafio vinculado convivem na mesma edição sem diferença de layout além de link+chip

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Deve existir a entidade `sponsors`: `id`, `name` (único, obrigatório), `url`, `tier` (`apoio`/`sponsor`/`master`, default `sponsor`), `contactEmail`, `notes`, `active`, `createdAt`
- **FR-002**: `challenges` DEVE aceitar `sponsorId` nullable (migração idempotente); leituras (`getChallenges`, `listChallenges`, `getChallenge`) DEVEM fazer LEFT JOIN expondo `sponsorId`, `sponsorUrl` e `sponsorTier`; `sponsor` TEXT segue obrigatório como nome de exibição
- **FR-003**: `POST /api/admin/sponsors` cria → 201; `GET /api/admin/sponsors` lista com contagem de desafios vinculados; deslogado → 401, não-admin → 403, name vazio/duplicado ou tier inválido → 400
- **FR-004**: `PATCH /api/admin/sponsors/[id]` edita `name`, `url`, `tier`, `contactEmail`, `notes`, `active` → 200; inexistente → 404; body vazio ou campo inválido → 400
- **FR-005**: `POST /api/admin/hackathons/[id]/challenges` DEVE aceitar `sponsorId` (valida existência → 400); sem `sponsor` textual copia o nome da entidade; `PATCH /api/admin/challenges/[challengeId]` DEVE aceitar `sponsorId` (string vincula, `null` desvincula)
- **FR-006**: `/h/[id]` DEVE renderizar sponsor vinculado como link externo (quando `url` presente) + chip de tier (master → lendário, sponsor → acento, apoio → muted); sem vínculo, só o texto
- **FR-007**: `/admin` DEVE ter seção "// sponsors" própria: lista (nome, tier, ativo, nº de desafios vinculados), formulário de criação (nome/url/tier/contato) e toggle ativo
- **FR-008**: Todos os dados DEVEM persistir no SQLite e sobreviver a restart (migração idempotente, sem tocar o exec principal de `lib/db.ts`)

### Key Entities

- **Sponsor**: marca pagante — `name` (único), `url`, `tier` (`apoio`/`sponsor`/`master`), `contactEmail`, `notes`, `active`
- **Challenge**: ganha `sponsorId` nullable → Sponsor; `sponsor` TEXT permanece como nome de exibição/fallback

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um desafio vinculado exibe nome+link+tier em `/h/[id]`; um desafio só-texto renderiza idêntico a antes
- **SC-002**: Organizador cadastra uma marca e a vincula a um desafio em <1 minuto via `/admin` + API
- **SC-003**: 100% dos sponsors e vínculos sobrevivem a restart; desativar é reversível (nunca perde o registro nem o histórico dos desafios)
- **SC-004**: Tier "master" é visualmente distinguível de "apoio" em <5 segundos na página pública

## Assumptions

- Sem upload de logo: a identidade da marca é nome+link+tier; logo/brand kit é fase seguinte
- Tier é taxonomia comercial (preço/pacote), não ranking de auditoria — vive no chip e no admin
- Vínculo desafio→sponsor é feito por `sponsorId` na API de desafios; o `/admin` não ganha picker de sponsor no formulário de desafio nesta fase
- `contactEmail`/`notes` são campos de CRM interno — nunca renderizam em página pública
- Seeds de desafios existentes (Oracle nas edições PUC/Unifacens) continuam só-texto — backfill de entidades é operação do admin, não migração
