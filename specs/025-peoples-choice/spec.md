# Feature Specification: Escolha do Povo — voto da comunidade em projetos

**Feature**: `025-peoples-choice`
**Created**: 2026-11-20
**Status**: Draft
**Input**: O arquivo (003) e o índice `/projetos` (017) só refletem o júri: `placement` é condecoração do organizador e ponto. TAIKAI tem votação da comunidade (leaderboard de $VOTE) como sinal separado — a torcida não tem onde se manifestar aqui. A "escolha do povo" deixa qualquer membro votar no projeto que acha foda: um voto por membro por projeto, toggle, separado do pódio — e sem XP, pra não virar farm.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Membro vota (e desvota) num projeto (Priority: P1)

Membro logado abre `/p/[teamId]` e vota no projeto com um clique — o botão mostra o total e o próprio estado (△ → ▲). Clicou de novo, desfez. Um membro = um voto por projeto, garantido por PK, então retry/duplo clique nunca infla o placar.

**Why this priority**: É o coração da feature — sem o toggle autenticado não existe sinal nenhum. Tudo o resto (contador no índice, ordenação) depende desse voto existir e ser confiável.

**Independent Test**: Membro faz `POST /api/projects/[teamId]/vote` → 200 `{voted:true, count:n}`; repete → `{voted:false, count:n-1}`. Duplo clique simultâneo não passa de 1 voto.

**Acceptance Scenarios**:

1. **Given** membro logado olhando projeto de outro time, **When** faz POST no endpoint de voto, **Then** recebe 200 `{voted:true, count}` e a linha `(memberId, teamId)` existe
2. **Given** membro que já votou, **When** repete o POST, **Then** o voto é removido e `count` decresce — toggle idempotente, nunca voto duplo
3. **Given** visitante deslogado, **When** faz POST, **Then** recebe 401 JSON (nunca redirect)
4. **Given** teamId inexistente, inválido ou time sem projeto, **When** membro faz POST, **Then** recebe 404
5. **Given** membro que é integrante do time dono do projeto, **When** faz POST, **Then** recebe 403 — voto é sinal da comunidade, não autopromoção

---

### User Story 2 - Visitante vê o placar do povo no índice e na ficha (Priority: P1)

`/projetos` mostra `▲ N` em cada card e a ficha `/p/[teamId]` exibe o total — o sinal da comunidade aparece ao lado do pódio do júri sem se misturar a ele. Anon vê o placar normalmente; quem tá logado vê o próprio voto destacado.

**Why this priority**: Voto invisível não motiva nem informa — o placar público é o que transforma clique em sinal de verdade.

**Independent Test**: Sem login, `/projetos` renderiza `▲ N` nos cards e `/p/[teamId]` mostra o contador; anon não vota (botão leva pro sign-in).

**Acceptance Scenarios**:

1. **Given** projeto com 3 votos, **When** visitante abre `/projetos`, **Then** o card mostra `▲ 3` mesmo deslogado
2. **Given** membro logado que votou no projeto, **When** abre `/p/[teamId]`, **Then** o botão aparece marcado (▲) com o total atualizado
3. **Given** visitante deslogado, **When** clica no botão de voto na ficha, **Then** é levado pro sign-in
4. **Given** membro olhando o próprio projeto, **When** abre a ficha, **Then** vê o placar mas o botão está desabilitado — sem votar em si

---

### User Story 3 - Índice ganha ordenação "escolha do povo" (Priority: P2)

`/projetos?sort=votes` reordena o índice por votos desc — o pódio do júri continua sendo a ordenação default, e o chip "escolha do povo" alterna pro ranking da comunidade. Desempate: placement e edição recente, mantendo a ordem determinística.

**Why this priority**: O leaderboard do povo é a metáfora do $VOTE da TAIKAI — mas é P2 porque depende de votos acumulados pra ser útil.

**Independent Test**: Com votos distintos em 2+ projetos, `/projetos?sort=votes` lista o mais votado primeiro, independente de placement.

**Acceptance Scenarios**:

1. **Given** projeto participante (placement 0) com mais votos que o campeão, **When** visitante abre `?sort=votes`, **Then** o participante aparece primeiro
2. **Given** `?sort=votes` ativo, **When** visitante filtra por edição (`?h=`) ou busca (`?q=`), **Then** a ordenação por votos sobrevive ao filtro
3. **Given** a ordenação default, **When** votos existem, **Then** nada muda — placement segue mandando (sinais separados, júri primeiro)

---

### Edge Cases

- Voto em time sem `team_projects` (não está no índice nem tem ficha) → 404, mesmo que o time exista
- `teamId` não-numérico ou inexistente → 404 (mesmo gate do deploy)
- Membro provisionado? clerkId sem linha em `members` → 401 (mesmo gate dos outros endpoints)
- Integrante tenta votar no próprio time → 403; se sair do time, pode votar (vínculo é por `team_members`, não por histórico)
- Remover time/projeto deixa votos órfãos: aceitável em v1 — as contagens são por `teamId` e param de aparecer junto com a ficha
- Voto não paga XP e não dispara badge — sinal, não moeda (decisão registrada pra não virar farm nem reabrir em review)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `lib/votes.ts` cria `votes(memberId, teamId, createdAt, PRIMARY KEY(memberId, teamId))` com schema idempotente no próprio módulo — sem tocar `lib/db.ts` (pattern `lib/leads.ts`)
- **FR-002**: `toggleVote(memberId, teamId)` → `{voted}` — insere quando não existe, remove quando existe; `VoteError` 404 quando o time não tem projeto, 403 quando o membro é integrante do time (via `team_members`/`username`)
- **FR-003**: `hasVoted(memberId, teamId)`, `voteCountFor(teamId)` e `getVoteCounts(teamIds)` cobrem leitura de estado e placar (ficha e listas)
- **FR-004**: `POST /api/projects/[teamId]/vote` — auth (401, membro precisa existir), projeto (404), próprio time (403 "não dá pra votar no teu próprio time") → 200 `{voted, count}`
- **FR-005**: `components/VoteButton.tsx` (client) na ficha `/p/[teamId]` — ▲/△ + contagem, toggle otimista com reversão em erro, 401 → `/sign-in`, desabilitado pro próprio time
- **FR-006**: `listProjects` ganha `voteCount` (subquery) e `votedByMe` (quando `meId` informado) + filtro `sort: "votes"` → ordena `voteCount` desc com desempate placement/edição
- **FR-007**: `/projetos` renderiza `▲ N` por card e chip `escolha do povo` (`?sort=votes`) que preserva `h`/`live`/`q`; ordenação default inalterada
- **FR-008**: Nenhum XP/badge novo — voto não é farmável; `lib/game.ts` e `lib/xp.ts` intactos

### Key Entities

- **Vote** (nova tabela `votes`): `(memberId, teamId)` — um voto por membro por projeto; sem coluna de valor pesado, votar é binário
- Reusa **teams/team_projects/team_members/members** de 003 — "projeto votável" = time com linha em `team_projects` (mesmo gate do índice e da ficha)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Membro vota/desvota em 1 clique e vê o resultado na hora (otimista), sem reload
- **SC-002**: 0 votos duplicados por `(membro, projeto)` em qualquer sequência de cliques — PK garante
- **SC-003**: `?sort=votes` ranqueia 100% dos projetos por votos desc, determinístico no desempate
- **SC-004**: Voto do próprio time é bloqueado em 100% das tentativas (403 garantido por teste)
- **SC-005**: XP de qualquer membro não muda ao votar ou receber voto (sinal ≠ moeda)

## Assumptions

- Votar exige ser membro (linha em `members`) — conta Clerk sem provisionamento cai no 401 padrão
- "Próprio time" = username do membro em `team_members` do time votado — não há checagem por edição nem por papel
- Votos ficam pra sempre (não expiram com o hackathon) — o arquivo é histórico e a escolha do povo também
- Remoção de voto é só pelo próprio toggle — não há veto do admin em v1
- O chip `escolha do povo` é ordenação, não filtro: nenhum projeto sai da lista por ter 0 votos
