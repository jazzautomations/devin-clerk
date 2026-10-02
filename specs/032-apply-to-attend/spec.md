# Feature Specification: Edições Curadas — "Pedir Lugar" (Apply to Attend)

**Feature**: `032-apply-to-attend`
**Created**: 2026-12-19
**Status**: Draft
**Input**: AI Tinkerers roda "apply to attend" — curadoria de presença é parte da marca. Hoje toda inscrição é instantânea (`register()` → linha aprovada + carta + XP na hora). Aqui a edição pode ser marcada pelo organizador como curada (`requiresApproval`): o membro "pede lugar", o pedido fica `pending` sem recompensa, e só a aprovação do admin minta a carta, paga o XP e abre os gates (time, board, mural). Rejeição é um estado honesto ("não rolou dessa vez"), não um sumiço.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Membro pede lugar numa edição curada (Priority: P1)

Membro logado abre `/h/[id]` (ou o card no radar) de uma edição marcada `requiresApproval` e vê "pedir lugar" em vez de "inscrever-se em 1 clique". O clique cria a inscrição com `status = 'pending'` — SEM carta, SEM +50xp, SEM badge `debut` — e a UI passa a mostrar "aguardando aprovação". O pedido pode ser cancelado pelo próprio membro (DELETE) enquanto pendente.

**Why this priority**: É o gesto central da feature — sem o pedido pendente não existe funil de curadoria.

**Independent Test**: `POST /api/hackathons/[id]/register` numa edição `requiresApproval=1` → 201 com `status: 'pending'`; `member_cards`, `xp` e `member_badges` do membro seguem intocados; `getRegistrationIds` NÃO inclui a edição.

**Acceptance Scenarios**:

1. **Given** edição curada ativa e membro logado sem inscrição, **When** faz POST no register, **Then** recebe 201 `{status: 'pending'}` e nenhuma recompensa
2. **Given** membro com pedido pendente, **When** refaz o POST, **Then** a resposta segue `pending` (idempotente — não duplica nem promove)
3. **Given** membro pendente, **When** faz DELETE, **Then** o pedido é cancelado (linha removida) e um novo POST recomeça o ciclo
4. **Given** edição NÃO curada, **When** membro faz POST, **Then** comportamento atual intacto: 200 `status: 'approved'` + XP + carta + badges
5. **Given** deslogado, **When** POST/DELETE/GET no register, **Then** 401 JSON (nunca redirect)

---

### User Story 2 - Admin cura a fila de pedidos (Priority: P1)

Na seção "inscritos" do `/admin`, edições curadas mostram pedidos pendentes no topo com chip "pendente" e botões "aprovar"/"recusar". Aprovar muda o status pra `approved`, grava `reviewedAt` e dispara o MESMO caminho de recompensa do register instantâneo (XP + carta + badges). Recusar marca `rejected` + `reviewedAt` — a linha fica como registro honesto da decisão.

**Why this priority**: Curadoria sem ferramenta de decisão é fila parada — o admin precisa destravar o pedido com um clique.

**Independent Test**: Com pedido pendente, `PATCH /api/admin/hackathons/[id]/registrations/[memberId]` com `{action: 'approve'}` → 200, status vira `approved`, membro recebe carta + XP; `{action: 'reject'}` → 200, status `rejected`.

**Acceptance Scenarios**:

1. **Given** pedido pendente, **When** admin aprova, **Then** status `approved`, `reviewedAt` preenchido, e recompensa completa (`+50xp`, carta mintada, badges avaliados)
2. **Given** pedido pendente, **When** admin recusa, **Then** status `rejected` + `reviewedAt`, sem recompensa
3. **Given** inscrição já aprovada, **When** admin aprova de novo, **Then** 200 idempotente SEM re-pagar XP (apenas confirma o estado)
4. **Given** inscrição rejeitada, **When** admin aprova depois, **Then** vira `approved` e a recompensa acontece naquele momento (decisão pode ser revertida)
5. **Given** `memberId` sem inscrição na edição (ou ação inválida), **When** PATCH, **Then** 404 (ou 400 pra ação); não-admin → 403; deslogado → 401

---

### User Story 3 - Gates e contagens tratam pendente como "não inscrito" (Priority: P1)

`getRegistrationIds` passa a retornar só `status = 'approved'`, então TODOS os consumidores herdam o comportamento: board "procuro time" (012), submissão de time (021), mural da edição (028), dashboard, histórico público do perfil e a lista "inscritos" de `/h/[id]`. Um membro pendente não posta no mural, não cria time e não aparece na lista pública — a contagem de inscritos da edição mostra só aprovados.

**Why this priority**: Se o pendente vazar pros gates, a curadoria é cosmética — qualquer um entraria pelos fundos.

**Independent Test**: Com registro `pending`, `POST /api/hackathons/[id]/team` e `POST /api/hackathons/[id]/team-board` → 403 "inscreve-te primeiro"; `getRegistrationsByHackathon` não lista o membro.

**Acceptance Scenarios**:

1. **Given** membro pendente, **When** tenta POST em team/team-board ou postar no mural da edição, **Then** 403 idêntico a não-inscrito
2. **Given** edição com 2 aprovados + 1 pendente, **When** qualquer um abre `/h/[id]`, **Then** a faixa mostra "2 inscritos" e a lista pública omite o pendente
3. **Given** aprovação posterior, **When** o membro tenta os gates de novo, **Then** passa normalmente
4. **Given** membro com 2 aprovadas + 1 pendente, **When** `checkBadges` roda por outra ação, **Then** o pendente NÃO conta pra `debut`/`veterano`; contagens públicas de "campanhas" e o arco do builder também ignoram pendentes/rejeitados

---

### User Story 4 - Organizador marca a edição como curada (Priority: P2)

O `EditEventForm` do admin ganha o checkbox "curadoria (pedir lugar)"; `PATCH /api/admin/hackathons/[id]` aceita `requiresApproval` booleano. Alternar a flag não reescreve inscrições existentes: aprovados seguem aprovados, pendentes seguem na fila pra decisão.

**Why this priority**: Sem a flag editável, o recurso só existiria via SQL — o organizador precisa ligar/desligar por edição.

**Independent Test**: `PATCH` com `{requiresApproval: true}` → 200 e `getHackathon(id).requiresApproval === true`; `EditEventForm` renderiza o checkbox marcado.

**Acceptance Scenarios**:

1. **Given** admin, **When** PATCH `requiresApproval: true/false`, **Then** 200 e o flag persiste; valor não-booleano → 400
2. **Given** edição aberta com inscritos, **When** admin liga a flag, **Then** inscrições `approved` existentes não mudam; só novos pedidos entram como `pending`
3. **Given** edição curada com pendentes, **When** admin desliga a flag, **Then** novos registers entram `approved` direto; a fila pendente existente continua exigindo decisão

---

### Edge Cases

- `register()` é `INSERT OR IGNORE`: re-POST em `pending` não reseta nem promove; em `rejected` também não reseta (o veredito fica — re-aprovação é decisão do admin)
- Edição curada arquivada/inativa: 404 no register como hoje (flag não muda o gate de `active`)
- `reviewedAt` é NULL enquanto pendente; toda decisão (approve/reject) grava timestamp
- Aprovar alguém que se inscreveu antes da flag existir: já está `approved` → 200 no-op sem XP duplo
- Rejeitar um membro já aprovado: permitido (revogação manual); carta/XP já pagos NÃO são estornados — o registro vira histórico
- `memberId` não numérico ou inscrição inexistente na edição → 404
- Pendente ainda pode ser puxado como colega de time se o AUTOR for aprovado (check de colega em `lib/teams.ts` é inline SQL fora do escopo — documentado como débito conhecido, invariante frouxo aceito em v1)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `hackathons.requiresApproval INTEGER NOT NULL DEFAULT 0` e `registrations.status TEXT NOT NULL DEFAULT 'approved'` + `registrations.reviewedAt TEXT` — ALTERs guardados em `lib/registrations.ts` (PRAGMA + ADD COLUMN idempotente, pattern `avatarUrl`); `lib/db.ts` intocado
- **FR-002**: `register(memberId, hackathonId)` retorna `{status, created}`: edição curada insere `pending`; aberta insere `approved` — NUNCA recompensa dentro de `register`; quem recompensa é `completeRegistration`
- **FR-003**: `completeRegistration(memberId, hackathonId)` = o caminho único de recompensa (`awardXp(XP.register)` + `mintCard` + `checkBadges`) — usado pelo register instantâneo e pela aprovação admin
- **FR-004**: `getRegistrationIds`/`getRegistrationsByHackathon` só retornam `approved`; `listRegistrants` (admin) retorna TODOS os status com `memberId`, `status`, `reviewedAt` — pendentes primeiro
- **FR-005**: `reviewRegistration(memberId, hackathonId, 'approve'|'reject')` — approve: transição não-aprovado→aprovado dispara `completeRegistration` (já aprovado = no-op sem recompensa); reject: marca `rejected`; ambos gravam `reviewedAt`; sem inscrição → `null`
- **FR-006**: `POST /api/hackathons/[id]/register` — 201 `{status:'pending'}` pra pedido novo em edição curada (re-POST pendente → 200), 200 `{status:'approved', xp, cardSerial, newBadges]` nas demais; `GET` retorna `{status}` do membro (401 anon); `DELETE` cancela qualquer pedido/inscrição
- **FR-007**: `PATCH /api/admin/hackathons/[id]` aceita `requiresApproval` booleano (whitelist + `EditEventForm` checkbox); `PATCH /api/admin/hackathons/[id]/registrations/[memberId]` com `{action}` → 200/400/403/404
- **FR-008**: UI honesta de status — edição curada mostra "pedir lugar" (CTA e card), pendente vê "aguardando aprovação" (com cancelar), rejeitado vê "não rolou dessa vez" (terminal, não clicável); contagem de inscritos e lista pública = aprovados
- **FR-009**: Recompensas derivadas ignoram pendentes: `checkBadges` conta `regs` só `approved`; "campanhas" do membro (`listMembers`, `listLeaderboard`) e o arco do builder (`getMemberArc`) filtram `approved` — cada arquivo guarda o próprio ALTER (pattern da casa)

### Key Entities

- **Hackathon**: + `requiresApproval` (edição curada ou aberta)
- **Registration**: + `status` (`pending` | `approved` | `rejected`), `reviewedAt` — linha preservada após rejeição (honestidade/auditoria); recompensa vive na transição pra `approved`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pedido pendente não gera NENHUMA recompensa antes da aprovação — `xp`, `member_cards` e `member_badges` intactos (teste unit + API)
- **SC-002**: 100% dos gates de escrita (team, team-board, mural) rejeitam pendente com 403 idêntico a não-inscrito
- **SC-003**: Lista pública e contagem de inscritos nunca exibem pendente/rejeitado
- **SC-004**: Admin aprova/recusa em 1 clique na tela que já usa hoje; aprovação dispara exatamente a recompensa do register instantâneo (uma vez — re-approve é no-op)

## Assumptions

- "Inscrito" pra todos os efeitos (gates, listas, badges, contagens) = `registrations.status = 'approved'`; pendente é candidato, não inscrito
- A decisão do admin é reversível (rejected → approved paga a recompensa na hora; approved → rejected é revogação sem estorno de recompensa já paga)
- Re-post de register em `rejected` não reabre o pedido — quem reabre é o admin
- Notificação ao membro sobre a decisão fica fora do escopo (spec 013 cobre o canal; aqui o estado na UI já é honesto)
