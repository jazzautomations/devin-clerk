# Feature Specification: Submissão de Time pelo Membro

**Feature**: `021-team-submission`
**Created**: 2026-11-16
**Status**: Draft
**Input**: O arquivo de edições (003) só se preenche pela mão do organizador (`/api/admin/hackathons/[id]/teams`). Quem participa não consegue cadastrar o próprio time+projeto — o arquivo fica refém da disponibilidade do admin e o membro não ganha portfólio. Aqui o inscrito submete o próprio time na edição em que está registrado: quando o hackathon termina, o projeto já está no arquivo e no portfólio de cada integrante.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inscrito cadastra o próprio time+projeto na edição (Priority: P1)

Membro inscrito numa edição abre `/h/[id]` e vê a seção "meu time": cria o time com nome, colegas (usernames de outros inscritos) e o projeto (título, descrição, repo, demo). O time nasce como participante (`placement = 0` — pódio é condecoração do organizador, nunca autoatribuída) e já vale como entrada do arquivo.

**Why this priority**: É o que faz o arquivo se auto-preencher — cada edição que acontece alimenta o histórico sem depender do organizador digitar tudo depois. Sem self-service o arquivo escala zero.

**Independent Test**: Membro inscrito em edição futura faz `POST /api/hackathons/[id]/team` com nome + projeto → 201 e o time aparece no arquivo/página `/p/[teamId]`.

**Acceptance Scenarios**:

1. **Given** membro inscrito sem time na edição, **When** submete nome + projeto válidos, **Then** recebe 201 com o time, `placement` 0, ele mesmo em `members` e +15xp
2. **Given** membro inscrito, **When** informa `memberUsernames` com um inscrito e um não-inscrito, **Then** o inscrito entra no time e o não-inscrito volta em `ignoredUsernames`
3. **Given** membro inscrito que já está num time da edição, **When** submete outro, **Then** recebe 409
4. **Given** membro inscrito, **When** escolhe um nome de time já usado na edição, **Then** recebe 409
5. **Given** membro NÃO inscrito na edição, **When** submete, **Then** recebe 403 ("inscreve-te primeiro"); deslogado → 401

---

### User Story 2 - Integrante edita o projeto do próprio time (Priority: P1)

Quem está no time ajusta título, descrição e links do projeto até o fim do evento — o arquivo registra a versão final sem intermediário. Time sem projeto pode criar um depois pelo mesmo caminho.

**Why this priority**: Projeto evolui durante o hackathon (nome muda, repo nasce no sábado). Sem edição o arquivo congela a primeira versão ou fica sem projeto.

**Independent Test**: Membro do time faz `PATCH /api/hackathons/[id]/team` com `teamId` + novo `repoUrl` → 200 e `/p/[teamId]` reflete.

**Acceptance Scenarios**:

1. **Given** membro do time, **When** edita `title`/`description`/`repoUrl`/`demoUrl`, **Then** recebe 200 com o projeto atualizado; campo enviado vazio limpa o valor
2. **Given** time sem projeto, **When** integrante envia `title` válido, **Then** o projeto é criado (upsert)
3. **Given** membro que NÃO é do time, **When** tenta editar, **Then** recebe 403; time de outra edição/inexistente → 404; deslogado → 401

---

### User Story 3 - Formulário "meu time" na página da edição (Priority: P2)

A página `/h/[id]` de edição não encerrada mostra, para o membro inscrito, a seção "meu time": formulário de criação quando ele ainda não tem time, ou resumo do time + edição do projeto quando já tem — com link direto pra ficha pública `/p/[teamId]`.

**Why this priority**: API sem UI exige curl; a seção na página da edição é onde o inscrito já está pra se registrar e procurar time.

**Independent Test**: Com sessão de inscrito, `/h/[id]` de edição futura mostra o formulário; anon/não-inscrito não vê nada além do CTA de inscrição.

**Acceptance Scenarios**:

1. **Given** inscrito sem time, **When** abre `/h/[id]` de edição não encerrada, **Then** vê o formulário "meu time" (nome, colegas, título/descrição/repo/demo)
2. **Given** inscrito com time, **When** abre a página, **Then** vê nome do time, integrantes e edição do projeto + link `/p/[teamId]`
3. **Given** visitante deslogado ou membro não inscrito, **When** abre a página, **Then** a seção não aparece
4. **Given** edição encerrada, **When** inscrito abre a página, **Then** a seção não aparece (o time já virou arquivo)

---

### Edge Cases

- `memberUsernames` inclui o próprio autor: deduplica silenciosamente (ele já entra automático)
- Username inscrito mas que já está em outro time da edição: vai pra `ignoredUsernames` (um membro = um time por edição — `memberTeamFor` precisa ser único)
- Time criado sem projeto: permitido — o projeto pode ser submetido depois via PATCH
- `placement` enviado pelo cliente é ignorado — sempre 0; só o admin promove pra pódio (003)
- Edição inexistente/inativa: 404 em todos os verbos
- URLs só http(s) — `javascript:` e afins → 400 (mesma regra do admin)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `memberTeamFor(hackathonId, username)` retorna o `ArchiveTeam` do membro na edição ou `null`
- **FR-002**: `submitTeam(hackathonId, member, {name, memberUsernames?, project?})` cria o time com `placement` SEMPRE 0, autor auto-vinculado, e colegas só se forem membros **inscritos na edição** e ainda sem time — os demais caem em `ignoredUsernames`. Nome duplicado na edição ou autor já com time → erro de conflito (409)
- **FR-003**: `updateTeamProject(teamId, member, patch)` edita título/descrição/urls do projeto — só integrante do time; cria o projeto quando não existe (upsert); string vazia limpa campo opcional; `title` nunca fica vazio
- **FR-004**: `POST /api/hackathons/[id]/team` — auth (401), edição ativa (404), inscrição (403 "inscreve-te primeiro"), validação (400), conflitos (409), sucesso 201 com `team` + `ignoredUsernames` + XP `teamSubmit` (+15) + `checkBadges`
- **FR-005**: `PATCH /api/hackathons/[id]/team` — auth (401), time existe e é da edição (404), integrante (403), patch validado (400) → 200 com `team`
- **FR-006**: `GET /api/hackathons/[id]/team` — auth (401), retorna o time+projeto do membro na edição (404 quando não tem); alimenta o formulário
- **FR-007**: `/h/[id]` mostra a seção "meu time" apenas quando `!past && member && registered` — diff mínimo, sem reestruturar a página; sucesso mostra link pra `/p/[teamId]`
- **FR-008**: Nenhuma tabela nova — reusa `teams`/`team_members`/`team_projects`/`registrations` (schema de 003 já cobre)

### Key Entities

- Reusa as de 003: **Team** (`placement` 0 = participante), **TeamProject** (1:1), **team_members** (vínculo por username). Novo conceito: **submissão** = time criado pelo próprio membro em vez do admin.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Inscrito cadastra time+projeto em <2 min na página da edição, sem falar com organizador
- **SC-002**: 100% dos times auto-submetidos têm `placement = 0` (organizador mantém monopólio do pódio)
- **SC-003**: Todo integrante inscrito vê o projeto no próprio portfólio (`/u/[username]`, via `getMemberProjects` de 003) sem custo extra
- **SC-004**: Não-inscrito não consegue criar time em nenhuma rota (403 garantido por teste)

## Assumptions

- "Inscrito" = linha em `registrations` — mesmo gate do board (012)
- Um membro = no máximo um time por edição (o formulário não oferece troca de time; sair do time é v2)
- Colocar colega no time não exige aceite dele em v1 — confiança de comunidade; username errado/inscrito em outro time só cai em `ignoredUsernames`
- Remoção de time/integrante fica fora do escopo (admin resolve caso a caso)
