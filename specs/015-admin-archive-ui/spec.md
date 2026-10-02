# Feature Specification: Admin — UI do Arquivo de Edições

**Feature**: `015-admin-archive-ui`
**Created**: 2026-11-03
**Status**: Draft
**Input**: Gap do spec 003 — as APIs de arquivo (`POST /api/admin/hackathons/[id]/teams` e `/assets`) existem, mas o cadastro é curl-only. O SC-002 do 003 ("organizador cadastra um time completo em menos de 1 minuto via admin") não se cumpre sem formulário no `/admin`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organizador cadastra time + projeto pela UI (Priority: P1)

Depois do evento, o organizador abre `/admin`, expande a edição encerrada e, na seção "// arquivo", preenche um formulário compacto: nome do time, colocação (1º/2º/3º/participante), usernames dos membros separados por vírgula e — opcionalmente, via "+ projeto" — título, descrição, repo e demo do projeto. Ao salvar, o time aparece na lista do arquivo e na página pública `/h/[id]`. Se algum username não existir, a tela avisa quais foram ignorados (o cadastro não falha — espelha `ignoredUsernames` da API).

**Why this priority**: É o fechamento do SC-002 do 003 — sem UI o arquivo continua dependendo de curl e na prática não se preenche.

**Independent Test**: Logado como admin, preencher nome+colocação+projeto no formulário da edição e ver o time listado ao recarregar; a página pública `/h/[id]` reflete na hora. Fluxo de formulário é verificação manual (e2e não passa do sign-in do Clerk — ver Assumptions).

**Acceptance Scenarios**:

1. **Given** admin na seção "// arquivo" de uma edição, **When** envia o formulário com nome, placement 1 e projeto com repo, **Then** a API retorna 201 e o time aparece no resumo do arquivo (e no pódio público)
2. **Given** time cadastrado com `memberUsernames` contendo username inexistente, **When** a API responde 201, **Then** o formulário mostra aviso listando os usernames ignorados antes do reload
3. **Given** formulário sem nome do time, **When** admin envia, **Then** a API responde 400 e a tela mostra o erro sem recarregar
4. **Given** campo "+ projeto" marcado sem título, **When** admin envia, **Then** o projeto não é criado (API ignora projeto sem título) e o time entra só com nome+colocação

---

### User Story 2 - Organizador adiciona material do evento (foto/slide/link) (Priority: P2)

Na mesma seção "// arquivo", um segundo formulário curto cadastra um material da edição: tipo (foto, slide ou material), URL externa e legenda opcional. Ao salvar, o contador de materiais do resumo sobe e o link aparece na página pública.

**Why this priority**: Completa o arquivo (fotos e slides são metade da promessa "prova de que o evento aconteceu"), mas o cadastro de times é o caminho crítico do pódio.

**Independent Test**: Admin envia o formulário com `foto` + URL do imgur → 201 → material aparece na página pública `/h/[id]`; URL sem http(s) recebe 400 com erro visível.

**Acceptance Scenarios**:

1. **Given** admin na seção "// arquivo", **When** envia `type=foto`, URL válida e legenda, **Then** a API retorna 201 e o resumo passa a contar +1 material
2. **Given** URL inválida (sem `http(s)`) ou tipo fora da whitelist, **When** admin envia, **Then** a API responde 400 e o erro aparece inline

---

### Edge Cases

- Resumo do arquivo vazio: a seção renderiza só os formulários ("0 times · 0 materiais") — edição nova já nasce pronta pra receber arquivo
- Username com `@` ou espaços: o backend já normaliza (`.replace(/^@/,""`) e lowercase); o aviso de ignorados cobre o que não existir
- Projeto parcial (só demo, sem repo): renderiza sem link ausente — o formulário só exige título
- Reload pós-cadastro é intencional (mesmo pattern dos outros forms do admin): simples e sempre consistente com o server-render

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cada `<details>` de edição no `/admin` DEVE ter seção "// arquivo" com resumo server-rendered: times ordenados por colocação (pódio primeiro) e contagem de materiais
- **FR-002**: Um formulário DEVE criar time via `POST /api/admin/hackathons/[id]/teams` com `name`, `placement` (0–3), `memberUsernames[]` (input separado por vírgula) e `project` opcional colapsado atrás de "+ projeto"
- **FR-003**: O formulário de time DEVE exibir aviso com `ignoredUsernames` quando a resposta trouxer a lista não-vazia, antes de recarregar
- **FR-004**: Um segundo formulário DEVE criar material via `POST /api/admin/hackathons/[id]/assets` com `type` (foto/slide/material), `url` e `caption` opcional
- **FR-005**: Erros 4xx da API DEVEM aparecer inline (pattern `// erro` dos outros forms); sucesso → `window.location.reload()`
- **FR-006**: Os formulários DEVEM ser compactos e consistentes com `ChallengeForm`/`EditEventForm` (mesmas classes, grid 2 col, botão accent)

### Key Entities

- Nenhuma nova — reusa `getArchive(hackathonId)` → `{teams, assets}` de `lib/archive.ts` e as APIs existentes do spec 003

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Organizador cadastra um time completo (nome+colocação+membros+projeto com repo) pela UI em menos de 1 minuto — sem curl, sem console
- **SC-002**: Todo cadastro possível via curl hoje é possível pela UI (times, projetos, fotos, slides, materiais)
- **SC-003**: Username inexistente nunca quebra o fluxo — o aviso de ignorados é visível antes do reload
- **SC-004**: Gate verde: `npm run test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build`

### Verificação manual (e2e não alcança `/admin` — ver Assumptions)

1. `npm run dev` → login como admin → `/admin` → expandir edição encerrada
2. Seção "// arquivo" mostra resumo (times existentes ordenados, contagem de materiais)
3. Preencher "cadastrar time": nome `Time Teste`, colocação `1º`, membros `user_real, fantasma`, marcar "+ projeto" com título+repo → enviar → aviso lista `fantasma` → página recarrega com o time no resumo e no pódio de `/h/[id]`
4. Preencher "adicionar material": `foto` + URL do imgur + legenda → enviar → contador sobe e link aparece em `/h/[id]`

## Assumptions

- APIs, lib e schema já existem e estão testados (spec 003: `tests/api/archive*.test.ts`, `tests/unit/archive.test.ts`) — esta feature é só UI + resumo
- e2e/Playwright não passa da tela de sign-in do Clerk (captcha) — cobertura automatizada fica nas APIs (já existente, ampliada com os 400s que faltavam) e a verificação de formulário é manual conforme acima
- Fotos continuam sendo URLs externas (decisão do 003); upload próprio é fase 2
- Sem edição/exclusão de time ou material nesta v1 — o histórico é append-only como o resto do admin
