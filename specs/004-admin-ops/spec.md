# Feature Specification: Admin Operacional

**Feature**: `004-admin-ops`
**Created**: 2026-10-03
**Status**: Draft
**Input**: F2 do PRD — o organizador opera o evento de verdade: edita dados da edição, vê quem se inscreveu (com e-mail) e exporta a base da newsletter. PRD §7: "Admin: cria evento mas não edita, não gere inscritos, não exporta e-mails."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organizador corrige a edição sem deploy (Priority: P1)

O evento mudou de local, a deadline esticou ou o link de inscrição trocou — hoje o organizador precisaria editar o seed e redeployar. Com esta feature ele abre `/admin`, expande a edição, altera os campos num formulário e salva: a página pública `/h/[id]` reflete na hora. Também pode arquivar/reativar uma edição (`active`) sem apagar o histórico.

**Why this priority**: É o gap literal do PRD ("cria evento mas não edita"). Dado errado na página pública é o que mais corrói credibilidade — mesmo problema do Google Form, outro sintoma.

**Independent Test**: Logado como admin, PATCH em `/api/admin/hackathons/[id]` com `{name, location}` novo retorna 200 e `getHackathon(id)` reflete; não-admin recebe 403, deslogado 401, edição inexistente 404.

**Acceptance Scenarios**:

1. **Given** admin logado e edição existente, **When** envia PATCH com `name` e `location` novos, **Then** recebe 200 com a edição atualizada e `/h/[id]` mostra os dados novos
2. **Given** admin logado, **When** envia PATCH com `format: "vale-tudo"`, **Then** recebe 400 e nada muda no banco
3. **Given** admin logado, **When** envia PATCH `{active: false}`, **Then** a edição some da listagem pública mas o registro (e as inscrições) permanecem
4. **Given** não-admin logado / deslogado / edição fantasma, **When** chama PATCH, **Then** recebe 403 / 401 / 404 respectivamente
5. **Given** PATCH parcial (só `location`), **When** aplicado, **Then** todos os outros campos permanecem intocados

---

### User Story 2 - Organizador vê quem se inscreveu por edição (Priority: P1)

Hoje o admin tem uma tabela única de "últimas 100 inscrições" misturando todos os eventos — pra operar uma edição ele precisa da lista daquela edição: quem, e-mail pra contato operacional ("mudou o endereço!"), e quando entrou. No `/admin`, cada edição expande e mostra seus inscritos.

**Why this priority**: Comunicação operacional com inscritos é o dia-a-dia do organizador; sem a lista por edição o painel é vitrine, não ferramenta.

**Independent Test**: Com 2 inscritos numa edição, GET `/api/admin/hackathons/[id]/registrations` retorna `{username, name, email, createdAt}` ordenado por entrada; mesmas guards (401/403/404).

**Acceptance Scenarios**:

1. **Given** edição com inscritos, **When** admin chama GET registrations, **Then** recebe lista com username, nome, e-mail e data de inscrição de cada um
2. **Given** edição sem inscritos, **When** admin chama, **Then** recebe lista vazia (200, não erro)
3. **Given** edição inexistente, **When** admin chama, **Then** recebe 404
4. **Given** não-admin ou deslogado, **When** chama, **Then** recebe 403 ou 401 — lista de e-mails nunca vaza
5. **Given** admin no `/admin`, **When** expande uma edição, **Then** vê a tabela de inscritos daquela edição (render server-side, sem fetch no cliente)

---

### User Story 3 - Organizador exporta a base da newsletter (Priority: P2)

A newsletter é o canal de aviso de próximas edições. O organizador precisa da lista de e-mails em formato que cole em qualquer ferramenta de envio — CSV de um clique a partir do `/admin`.

**Why this priority**: Fecha o ciclo da base de e-mail (PRD: "base de e-mail" é dever do organizador). Valor real mas menor que P1 — a lista já aparece na tela, falta poder levar embora.

**Independent Test**: GET `/api/admin/subscribers` retorna JSON `{email, createdAt}[]`; GET com `?format=csv` retorna `text/csv` baixável; não-admin 403, deslogado 401.

**Acceptance Scenarios**:

1. **Given** 3 assinantes, **When** admin chama GET `/api/admin/subscribers`, **Then** recebe os 3 com `createdAt`
2. **Given** assinantes, **When** admin chama `?format=csv`, **Then** recebe `text/csv` com header `email,createdAt` e uma linha por assinante
3. **Given** CSV com e-mail contendo vírgula/aspas (edge), **When** exporta, **Then** o campo sai escapado entre aspas
4. **Given** não-admin ou deslogado, **When** chama (json ou csv), **Then** recebe 403/401 — a base nunca é pública
5. **Given** admin no `/admin`, **When** clica "exportar csv", **Then** o browser baixa o arquivo

---

### Edge Cases

- PATCH com body vazio ou sem nenhum campo conhecido → 400 (não é no-op silencioso)
- PATCH `active: false` numa edição com inscritos: edição sai do radar público, inscrições e cartas mintadas permanecem (histórico é sagrado)
- `endsAt`/`location`/`registrationDeadline` aceitam `null` (ou `""` no form) pra limpar o campo — nem todo evento tem fim/local definido
- `tags` deve ser array de strings; outra coisa → 400
- Inscrito que deletou a conta: a linha de inscrição referencia `memberId` — join com members significa que ele some da lista (decisão: e-mail é dado vivo do membro, não snapshot)
- Assinante se inscreve 2×: `UNIQUE(email)` já garante uma linha só no CSV
- A página `/admin` continua exigindo role admin (redirect/notFound já existente) — a UI nova não abre brecha

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `PATCH /api/admin/hackathons/[id]` DEVE aceitar edição parcial de `name`, `startsAt`, `endsAt`, `format`, `location`, `registrationUrl`, `registrationDeadline`, `tags` e `active`; campos ausentes permanecem intocados
- **FR-002**: Validação igual à criação: `name`/`startsAt`/`format`/`registrationUrl` não vazios quando presentes, `format ∈ {online, presencial, hibrido}`, `tags` array de strings, `active` booleano, campos de texto/data opcionais aceitam `null`
- **FR-003**: `GET /api/admin/hackathons/[id]/registrations` DEVE retornar `username`, `name`, `email` e `createdAt` de cada inscrito, ordenado por data de inscrição
- **FR-004**: `GET /api/admin/subscribers` DEVE retornar `{email, createdAt}[]`; com `?format=csv` DEVE responder `text/csv` com header `email,createdAt`
- **FR-005**: Todas as rotas DEVEM guardar: deslogado → 401 JSON, membro não-admin → 403, edição inexistente (rotas com `[id]`) → 404
- **FR-006**: `/admin` DEVE mostrar por edição: contagem de inscritos, lista expansível com os inscritos (render server-side) e formulário de edição que chama o PATCH
- **FR-007**: `/admin` DEVE oferecer link de exportação CSV da newsletter
- **FR-008**: Dados editados via PATCH DEVEM refletir imediatamente na página pública `/h/[id]` (mesma fonte de dados)

### Key Entities

- Nenhuma entidade nova — a feature opera sobre `hackathons` (edição dos campos existentes), `registrations ⋈ members` (lista por edição com e-mail) e `subscribers` (exportação)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Organizador corrige qualquer campo de uma edição e vê a mudança na página pública em <1 minuto, sem tocar código nem redeploy
- **SC-002**: Organizador responde "quantos/quem se inscreveu na edição X" em <30 segundos a partir do `/admin`
- **SC-003**: Exportação CSV abre direto em planilha (Excel/Sheets) sem edição manual — uma linha por assinante
- **SC-004**: 0 vazamento: todas as rotas respondem 401/403 corretos; e-mail de membro nunca aparece em rota pública

## Assumptions

- A tabela global "inscrições" do `/admin` é substituída pela lista expansível por edição — a visão por edição cobre o caso operacional
- `active: false` continua sendo a forma de "arquivar" (soft-delete já existente); esta feature só expõe o toggle
- E-mail do inscrito é dado operacional legítimo do organizador (ele já vê e-mails na tabela de membros hoje); exportação é só de subscribers — inscritos ficam na tela, sem CSV em v1
- Edição por formulário inline no `/admin` — sem página separada de "editar edição"
