# Feature Specification: Radar mostra eventos em andamento

**Feature**: `027-radar-ongoing`
**Created**: 2026-10-02
**Status**: Draft
**Input**: O radar lista `getUpcomingHackathons` (`startsAt > now`), mas eventos do Devpost usam `startsAt` = ABERTURA da janela de submissão — que já passou enquanto o evento roda. Resultado medido no banco real: 73 ativos, só 27 aparecem; **43 eventos em andamento (25 com prêmio) invisíveis**. Um evento está "aberto" enquanto não acabou: `COALESCE(endsAt, registrationDeadline, startsAt) >= now`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evento em andamento aparece no radar (Priority: P1)

Um hackathon cuja janela de submissão já abriu (`startsAt` no passado) mas ainda não terminou (`endsAt` ou `registrationDeadline` no futuro) aparece em `/radar` — hoje ele some no limbo: nem "aberto" nem "arquivo". Quem abre o radar durante um Devpost de 30 dias vê o evento e ainda consegue entrar.

**Why this priority**: É o bug inteiro — quase metade dos eventos ativos (43 de 73) e a maioria dos com prêmio estão invisíveis. Radar que esconde evento rolando não serve pra descobrir onde participar agora.

**Independent Test**: Banco com evento `startsAt` ontem + `endsAt` em 10 dias → `GET /radar` lista o card com estado "em andamento".

**Acceptance Scenarios**:

1. **Given** evento com `startsAt` passado e `endsAt` futuro, **When** abre `/radar`, **Then** o card aparece na lista (hoje some)
2. **Given** evento com `startsAt` futuro, **When** abre `/radar`, **Then** aparece normalmente (comportamento mantido)
3. **Given** evento com `endsAt` passado, **When** abre `/radar`, **Then** NÃO aparece na lista de abertos (vai pro arquivo)
4. **Given** evento sem `endsAt` mas com `registrationDeadline` futuro e `startsAt` passado, **When** abre `/radar`, **Then** aparece (deadline de inscrição é proxy de fim)
5. **Given** evento sem `endsAt` nem `registrationDeadline` e `startsAt` passado, **When** abre `/radar`, **Then** NÃO aparece — sem dado de fim, passado é passado

---

### User Story 2 - Card de evento em andamento mostra "em andamento" (Priority: P1)

O card de um evento rolando não diz "data: 15 de set." (passado, parece encerrado) — diz **"em andamento"** e, quando há `endsAt`, "até DD de mês". A linha de inscrições segue a regra atual (encerradas / até DD/MM / abertas).

**Why this priority**: Listar o evento sem marcar que ele já começou é meia-correção — o usuário precisa saber que dá pra entrar AGORA e quando acaba.

**Independent Test**: Card de evento ongoing renderiza "em andamento · até {endsAt}"; card de evento futuro continua mostrando a data de início.

**Acceptance Scenarios**:

1. **Given** card de evento ongoing com `endsAt`, **When** renderiza, **Then** o campo data mostra "em andamento · até {data de fim}"
2. **Given** card de evento ongoing sem `endsAt`, **When** renderiza, **Then** mostra "em andamento"
3. **Given** evento futuro, **When** renderiza, **Then** campo data mostra a data de início como hoje
4. **Given** sessão parceira (`partner`) ongoing, **When** renderiza, **Then** mesma regra — sem tratamento especial

---

### User Story 3 - Stats da landing mostram momentum 30d (Priority: P2)

Os números da landing (`membros`, `hackathons abertos`, `edições no arquivo`, `posts no feed`) ganham sub-linha "+N · 30d" no padrão DoraHacks — **só onde existe timestamp real**: `members.createdAt`, `posts.createdAt` e `hackathons.first_seen` (gravado pelo scraper quando descobre o evento). "Edições no arquivo" não tem data de entrada → não mostra "+N".

**Why this priority**: Prova social de produto vivo — mas "+N" inventado é pior que nenhum; só renderiza onde a contagem é honesta.

**Independent Test**: Membro criado hoje + evento com `first_seen` hoje → landing mostra "+1 · 30d" sob membros e hackathons abertos; stat de arquivo nunca tem sub-linha.

**Acceptance Scenarios**:

1. **Given** 2 membros e 1 post criados nos últimos 30d, **When** abre `/`, **Then** "membros" mostra "+2 · 30d" e "posts no feed" "+1 · 30d"
2. **Given** evento com `first_seen` nos últimos 30d e ainda aberto, **When** abre `/`, **Then** "hackathons abertos" mostra "+N · 30d"
3. **Given** contagem zero na janela, **When** renderiza, **Then** a sub-linha não aparece (nunca "+0")
4. **Given** evento sem `first_seen` (seed/comunidade/admin), **When** conta momentum, **Then** não entra — timestamp que não existe não é inventado

---

### Edge Cases

- `endsAt == now` exato: ainda aberto (fronteira é `<` estrito; "acabou" é passado)
- `endsAt` passado mas `registrationDeadline` futuro: COALESCE pega `endsAt` primeiro → encerrado. Deadline não ressuscita evento acabado
- `startsAt` inválida/vazia nunca chega — coluna é NOT NULL; `endsAt`/`deadline` inválidos caem no COALESCE seguinte via `NaN` tratado como "não é passado" no JS e `datetime()` NULL no SQL
- Indicação da comunidade sem data (`NO_DATE_SENTINEL` 2099): sempre aberta — já nasce no fim da agenda, inalterado
- Evento ongoing na página `/h/[id]`: continua mostrando modo arquivo local (página fora do escopo — `past` lá é startsAt-based; v2 pode revisitar)
- Sitemap continua completo: `open ∪ past = todos os ativos` — nenhuma URL de edição some

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `isOver(h, now)` em `lib/hackathons.ts` — encerrado ⇔ `COALESCE(endsAt, registrationDeadline, startsAt)` (primeira não-nula) é anterior a `now`; data inválida conta como "não encerrado"
- **FR-002**: `getOpenHackathons(now)` (renomeia `getUpcomingHackathons` — o nome antigo mente quando inclui ongoing) retorna ativos não-encerrados, ordenados por `startsAt` crescente — ongoing primeiro (começaram antes), futuros depois
- **FR-003**: `getPastHackathons(now)` passa a ser o complemento exato (`isOver`) — edição rolando sai do arquivo e vai pro radar
- **FR-004**: `searchHackathons` e o default de `getTags` passam a operar sobre a lista aberta; `isRegistrationClosed` inalterado
- **FR-005**: Todos os callers atualizados: `/radar`, `/` (destaque + stats), `/dashboard`, `GET /api/hackathons`, `buildSitemap`
- **FR-006**: `HackathonCard` mostra "em andamento" no campo data quando `startsAt <= now` (e o evento está na lista aberta); com `endsAt` → "em andamento · até {fim}"
- **FR-007**: Scraper coerente: `is_expired` e `sweep_expired` usam `COALESCE(endsAt, registrationDeadline, startsAt)` — evento com deadline de inscrição futuro nunca é desativado pelo varredor
- **FR-008**: `getStatsMomentum(now)` conta membros/posts criados e eventos `first_seen` nos últimos 30d (eventos: `active=1` e ainda abertos); `first_seen`/`last_seen` viram migração idempotente em `lib/db.ts` pra coluna existir mesmo sem scrape rodado
- **FR-009**: Landing renderiza "+N · 30d" sob o stat somente quando a contagem é >0; "edições no arquivo" nunca tem sub-linha (não há timestamp de entrada no arquivo)

### Key Entities

- Nenhuma nova. Reusa **hackathons** (`endsAt`, `registrationDeadline`, `first_seen`, `last_seen` — as duas últimas hoje criadas só pelo `ensure_schema` do scraper), **members.createdAt**, **posts.createdAt**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos eventos ativos com janela ainda aberta aparecem em `/radar` — no banco atual: de 27 para 70 cards (+43 ongoing)
- **SC-002**: Nenhum evento encerrado (todas as datas de fim no passado) aparece entre os abertos — complemento exato com o arquivo
- **SC-003**: `sweep_expired` do scraper nunca desativa evento cuja `COALESCE` ainda está no futuro (teste: deadline futuro + start passado fica ativo)
- **SC-004**: "+N · 30d" só aparece com contagem real — `0` nunca renderiza, métrica sem timestamp nunca inventa

## Assumptions

- "Aberto" é sobre o EVENTO não ter acabado, não sobre inscrição estar aberta — essa continua em `registrationDeadline`/isRegistrationClosed e na linha própria do card
- `first_seen` ausente (seeds, comunidade, admin manual) significa "não sabemos quando entrou" → fora do momentum. A coluna passa a existir sempre via `lib/db.ts`, mas só o scraper a preenche
- Ordem da lista segue `startsAt` asc — ongoing naturalmente encabeça; reordenar por "acaba antes" é decisão de v2
- `/h/[id]`, arena e demais leituras de `startsAt` ficam como estão (escopo = listas do radar)
