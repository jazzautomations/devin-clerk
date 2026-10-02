# Feature Specification: Empresas — porta comercial, leads e legal

**Feature**: `022-empresas-leads`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Monetização do PRD (seção 6): participante nunca paga — quem paga é a marca. Hoje existem sponsors (019), desafios patrocinados (006) e o diretório /talento (014), mas nenhuma porta de entrada pra empresa: não há pitch, não há como dizer "quero patrocinar" e não há captura de lead. Além disso, a plataforma coleta dados (perfil público, e-mail de newsletter/inscrição, cookies do Clerk) sem nenhuma página legal — LGPD básica exige termos + privacidade.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Empresa entende a oferta e deixa contato (Priority: P1)

Alguém de uma marca (devrel, marketing, RH, founder) chega em `/empresas` — pelo link comercial da landing ou direto — e entende em uma tela o que está à venda: desafio patrocinado numa edição, presença permanente no radar/arquivo e acesso a talento que entrega de verdade. A prova social são os números reais do banco (membros, edições, projetos entregues) e exemplos reais (Oracle na PUC, prêmio de R$5 mil na Unifacens). No fim da página, um formulário curto — empresa, e-mail, interesse, mensagem opcional — vira um lead pro organizador.

**Why this priority**: É o funil inteiro numa porta: sem ela, a monetização do PRD depende de contato manual (DM/e-mail solto). Com ela, qualquer marca que clicar "quero patrocinar" vira registro no CRM.

**Independent Test**: Abrir `/empresas` deslogado, ler a proposta, preencher o formulário e receber confirmação; o lead aparece listado no `/admin` e persiste em `leads`.

**Acceptance Scenarios**:

1. **Given** visitante deslogado, **When** abre `/empresas`, **Then** vê hero "sua marca na frente de quem constrói", a oferta (desafio patrocinado / presença no radar-arquivo / talento com link `/talento`) e stats reais do banco
2. **Given** o pitch, **When** renderiza, **Then** cita exemplos reais de patrocínio (Oracle na edição da PUC, prêmio de R$5 mil na Unifacens) com ênfase de prêmio no token lendário
3. **Given** formulário preenchido corretamente, **When** envia, **Then** POST `/api/leads` → 201 e a UI confirma sem recarregar
4. **Given** campo `website` (honeypot) preenchido por bot, **When** POST, **Then** 201 silencioso sem gravar nada
5. **Given** mesmo e-mail+empresa reenviado em <10 min, **When** POST, **Then** 200 idempotente sem duplicar o lead

---

### User Story 2 - Organizador vê os leads no admin (Priority: P2)

O organizador abre `/admin` e vê a seção "// leads" com as empresas que pediram contato, em ordem decrescente: empresa, e-mail, interesse e quando chegou. É a fila de prospecção da operação.

**Why this priority**: Lead capturado sem lugar pra ler é lead perdido — mas o P1 já demonstra o funil completo com a API.

**Independent Test**: Logado como admin, POST em `/api/leads` e a seção "// leads" do `/admin` mostra a empresa no topo.

**Acceptance Scenarios**:

1. **Given** admin logado, **When** abre `/admin`, **Then** a seção "// leads" lista empresa, e-mail, interesse e data, mais recente primeiro
2. **Given** sem leads, **When** renderiza, **Then** empty state honesto, nunca quebra
3. **Given** deslogado, **When** abre `/admin`, **Then** middleware manda pro sign-in (leads nunca são públicos)

---

### User Story 3 - Visitante encontra termos e privacidade (Priority: P3)

Qualquer um pode abrir `/legal/termos` e `/legal/privacidade` e ler, em PT-BR honesto e curto: o que a plataforma é, o que ela coleta (perfil público com nome/bio/skills/links, e-mail de newsletter e inscrições, cookies só de auth do Clerk) e como pedir remoção. São linkadas do rodapé da página `/empresas` — a página comercial é onde a empresa mais precisa dessa garantia.

**Why this priority**: LGPD básica — dá legitimidade ao funil e cobre a coleta que já existe. P3 porque não bloqueia a venda, mas é obrigação pra uma plataforma que guarda dado pessoal.

**Independent Test**: Abrir `/legal/termos` e `/legal/privacidade` deslogado → 200 com heading próprio e texto real; `/sitemap.xml` inclui as duas rotas e `/empresas`.

**Acceptance Scenarios**:

1. **Given** visitante deslogado, **When** abre `/legal/privacidade`, **Then** lê quais dados são coletados, pra quê, e como pedir remoção/contato
2. **Given** visitante deslogado, **When** abre `/legal/termos`, **Then** lê o contrato de uso (conteúdo do usuário, conduta, isenção)
3. **Given** o sitemap, **When** `GET /sitemap.xml`, **Then** inclui `/empresas`, `/legal/termos` e `/legal/privacidade`
4. **Given** `/empresas` renderizada, **When** o visitante chega ao fim, **Then** encontra links pras duas páginas legais

---

### Edge Cases

- Bot preenche o honeypot `website` → 201 sem gravar (a resposta é indistinguível de sucesso pro cliente)
- Retry/duplo clique no formulário → mesma empresa+e-mail em <10 min devolve o lead existente (200), nunca duplica
- Mesmo e-mail com empresa diferente, ou depois da janela de 10 min → lead novo (201) — dedupe é por par empresa+e-mail dentro da janela
- `interest` fora da whitelist (desafio/edicao/talento/outro) → 400; `company` vazio ou e-mail malformado → 400
- `message` é opcional — null quando ausente
- Sem rodapé global no layout hoje — os links legais vivem no fim de `/empresas` (não adicionar footer nem mexer na ordem do Header)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Deve existir a entidade `leads`: `id` INTEGER PK, `company` NOT NULL, `email` NOT NULL, `interest` NOT NULL (whitelist `desafio`/`edicao`/`talento`/`outro`), `message` nullable, `createdAt` — schema idempotente em `lib/leads.ts` no pattern de `lib/deploys.ts`/`lib/sponsors.ts`, sem tocar `lib/db.ts`
- **FR-002**: `createLead` DEVE validar: `company` obrigatória, formato de e-mail, `interest` na whitelist; DEVE deduplicar por (e-mail, empresa) dentro de janela de 10 minutos retornando o lead existente sem inserir
- **FR-003**: `POST /api/leads` é PÚBLICO (sem auth — é a porta comercial): honeypot `website` preenchido → 201 sem gravar; body válido → 201 com o lead; dedupe → 200; inválido → 400
- **FR-004**: `/empresas` é página pública (server component) com hero, oferta em 3 itens (desafio patrocinado com exemplos reais citados, presença no radar/arquivo, talento com link `/talento`), stats lidos do banco (membros, edições, projetos entregues) e o formulário de lead
- **FR-005**: `/empresas` DEVE exportar `generateMetadata` com `title`, `description` e `alternates.canonical`
- **FR-006**: `/admin` DEVE ter seção "// leads" listando `company`, `email`, `interest` e `createdAt` em ordem decrescente (diff mínimo — só apêndice de seção)
- **FR-007**: `/legal/termos` e `/legal/privacidade` são páginas estáticas públicas com texto PT-BR real (o que coleta: perfil público, e-mail p/ newsletter e inscrições; cookies só de auth; dados públicos do perfil; contato/remoção) e `metadata` própria
- **FR-008**: `/empresas`, `/legal/termos` e `/legal/privacidade` DEVEM entrar no `STATIC_ROUTES` de `lib/seo.ts` e sair no `/sitemap.xml`
- **FR-009**: A linha comercial da landing (`/`) DEVE linkar `/empresas` (hoje aponta pra uma edição); `/empresas` DEVE linkar as páginas legais no fim
- **FR-010**: Dados persistem no SQLite e sobrevivem a restart

### Key Entities

- **Lead**: empresa interessada — `company`, `email`, `interest` (`desafio`/`edicao`/`talento`/`outro`), `message?`, `createdAt`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma marca completa o funil em <1 minuto: `/empresas` → formulário → confirmação; o lead aparece no `/admin` sem intervenção
- **SC-002**: 0 leads duplicados por retry dentro de 10 minutos; 0 leads gravados por bot via honeypot
- **SC-003**: `/empresas`, `/legal/termos` e `/legal/privacidade` retornam 200 deslogadas e constam no sitemap
- **SC-004**: 100% dos leads sobrevivem a restart do servidor

## Assumptions

- Interesse é uma whitelist fechada (o select não permite texto livre; "outro" cobre o resto, detalhado em `message`)
- O organizador lê leads no `/admin` — notificação por e-mail/webhook é fase seguinte
- Rate limit é lite por desenho (dedupe empresa+e-mail na janela); WAF/Captcha ficam pro tunnel/proxy
- Sem footer global hoje: os links legais ficam no fim de `/empresas`; Header não muda
- Texto legal é informativo e honesto (o que coleta de fato), não parecer jurídico — revisão por advogado é responsabilidade da operação
