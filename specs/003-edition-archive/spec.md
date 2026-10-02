# Feature Specification: Arquivo de Edições

**Feature**: `003-edition-archive`
**Created**: 2026-10-02
**Status**: Draft
**Input**: F1 do PRD — cada edição de hackathon vira arquivo público com times, pódio, projetos, repos, fotos e materiais (definição do César nos áudios: "um lugar só que organiza os hackathons: fotos, equipes campeãs, projetos, slides, repositório GitHub de cada time")

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante lê o arquivo de uma edição passada (Priority: P1)

Alguém que ouviu falar do Hack Inova (ou que desconfiou do evento) abre `/h/[id]` de uma edição encerrada e vê a história completa: quem ganhou (pódio), os times participantes, o que cada projeto fez com link pro repositório/demo, fotos e materiais. É a prova pública de que o evento aconteceu e foi real — substitui "site novo a cada edição".

**Why this priority**: É o núcleo da definição do César — arquivo organizado é a feature-mãe que justifica a plataforma existir. Sem isso `/h/[id]` de edição passada é casca vazia.

**Independent Test**: Abrir `/h/hack-inova-unifacens-2026` e ver pódio + times + projetos sem precisar de login nem de outra feature.

**Acceptance Scenarios**:

1. **Given** edição encerrada com dados de arquivo cadastrados, **When** visitante abre `/h/[id]`, **Then** vê seção "resultado" com pódio (1º/2º/3º) antes da lista completa de times
2. **Given** um time no arquivo, **When** visitante clica no projeto, **Then** o link do repositório abre em nova aba
3. **Given** edição encerrada sem dados de arquivo, **When** visitante abre a página, **Then** vê empty state honesto ("arquivo em organização"), nunca quebra
4. **Given** edição futura/aberta, **When** visitante abre a página, **Then** a seção de arquivo NÃO aparece (resultado só faz sentido pós-evento)

---

### User Story 2 - Organizador cadastra o arquivo via admin (Priority: P2)

O organizador (jazz/César) depois do evento entra no `/admin`, abre a edição e cadastra: times com nome, colocação (1º/2º/3º/participante), projeto com descrição + repo + demo, e links de materiais (slides, fotos, guia).

**Why this priority**: Sem entrada de dados pelo organizador o arquivo nunca se preenche — mas o P1 já pode ser demonstrado com seed real da Unifacens.

**Independent Test**: Logado como admin, POST no endpoint admin adiciona time+projeto e a página pública reflete na hora; não-admin recebe 403.

**Acceptance Scenarios**:

1. **Given** admin logado, **When** cadastra time "One Day Hospital" com placement 1 e repo, **Then** `/h/[id]` mostra o time no pódio
2. **Given** não-admin logado, **When** chama a API de arquivo, **Then** recebe 403
3. **Given** deslogado, **When** chama a API de arquivo, **Then** recebe 401

---

### User Story 3 - Time vinculado a membros ganha crédito no perfil (Priority: P3)

Quando o organizador marca que um time era formado por membros cadastrados (por username), o projeto aparece no perfil público de cada um como "projeto campeão na edição X" — o histórico vira portfólio verificável.

**Why this priority**: É o elo entre arquivo e rede social — mas depende dos membros existirem; valor incremental sobre P1+P2.

**Independent Test**: Cadastrar time com `memberUsernames` e abrir `/u/[username]` mostra o projeto na seção de campanhas.

**Acceptance Scenarios**:

1. **Given** time com membros vinculados por username, **When** abre `/u/[username]`, **Then** projeto aparece com colocação ("🥇" ou "1º lugar" textual) e link pro repo
2. **Given** username que não existe, **When** organizador vincula, **Then** sistema ignora com aviso (não quebra o cadastro)

---

### Edge Cases

- Edição futura não deve mostrar seção de resultado (resultado antes do evento é spoiler/erro)
- Time sem projeto cadastrado: mostra só o nome + colocação
- Projeto sem repo (só demo, ou nada): renderiza sem o link ausente, nunca link quebrado
- Membro sai da plataforma: nome do time permanece (dado histórico), vínculo some
- Fotos: v1 aceita só URLs externas (imgur/drive/etc) — upload próprio é fase 2

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada edição (`/h/[id]`) DEVE ter seção de arquivo com times cadastrados, ordenada por colocação (pódio primeiro)
- **FR-002**: Times DEVEM ter nome e colocação (1º, 2º, 3º, ou participante); PODEM ter projeto com título, descrição, repo e demo
- **FR-003**: Organizadores (role admin) DEVEM poder criar times/projetos/materiais por edição via API autenticada; não-admin → 403, deslogado → 401
- **FR-004**: A seção de arquivo DEVE aparecer apenas em edições passadas (data de início < hoje) ou quando houver dados — edição futura sem dados não mostra seção vazia
- **FR-005**: Membros vinculados ao time por username DEVEM ter o projeto listado no perfil público com a colocação
- **FR-006**: Edição DEVE aceitar materiais/avulsos: fotos (URLs), slides e links de referência, renderizados como lista/galeria simples
- **FR-007**: Todos os dados de arquivo DEVEM persistir no banco e sobreviver a restart

### Key Entities

- **Team**: nome, colocação (`placement`: 1/2/3/0=participante), edição, membros (usernames vinculados opcionais)
- **Project**: pertence a um time — título, descrição, repoUrl, demoUrl
- **EditionAsset**: pertence a uma edição — tipo (foto/slide/material), url, legenda opcional

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: As 3 edições passadas do Hack Inova (Unifacens, PUC, Anhembi) exibem arquivo com pódio e projetos
- **SC-002**: Organizador cadastra um time completo (nome+colocação+projeto+repo) em menos de 1 minuto via admin
- **SC-003**: 100% dos dados de arquivo sobrevivem a restart do servidor
- **SC-004**: Visitante entende quem ganhou a edição em <10 segundos olhando a página (pódio visível sem scroll excessivo)

## Assumptions

- Fotos são URLs externas em v1 — upload/storage próprio fica pra fase seguinte (decisão de infra)
- Membros de time que não têm conta aparecem como texto simples, sem link
- Dados reais disponíveis hoje: Unifacens teve ~280 alunos, 10 equipes, 8 finalistas, 3 no pódio, 1º lugar "One Day Hospital" — seed cobre o que é público; resto entra pelo admin
- Vínculo membro↔time é por username declarado pelo organizador (não por claim do membro)
