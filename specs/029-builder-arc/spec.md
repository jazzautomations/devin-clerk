# Feature Specification: Trajetória do Builder no Perfil

**Feature**: `029-builder-arc`
**Created**: 2026-12-05
**Status**: Draft
**Input**: O perfil `/u/[username]` já lista campanhas (inscrições) e projetos com colocação, mas como listas soltas — ninguém lê o arco. O "earn your place" do Colosseum mostra a trajetória do builder através das edições ("competiu 4x: menção → 1º de track → grand prize") e é isso que transforma histórico em reputação. Aqui a trajetória vira uma faixa narrativa no topo do histórico: cada edição em ordem cronológica com o desfecho (pódio, entrega ou participação), mais uma linha-resumo de edições/pódios/projetos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante lê a trajetória do builder em ordem (Priority: P1)

Quem abre `/u/[username]` vê, antes da lista de projetos, a seção "// trajetória": uma faixa horizontal com uma entrada por edição em que o membro participou — da mais antiga pra mais recente — cada uma linkando pra `/h/[id]` e marcada com o desfecho: `1º lugar` (lendário), `2º lugar` (épico), `3º lugar` (raro), `entregou projeto` (accent) ou `participou` (muted).

**Why this priority**: É a feature inteira — a leitura cronológica do arco é o que diferencia trajetória de lista. Sem ela o perfil continua sendo inventário, não narrativa.

**Independent Test**: Membro com time campeão numa edição antiga, inscrição sem time numa edição do meio e time com projeto sem pódio na mais recente → `/u/[username]` mostra três chips nessa ordem, com os rótulos certos.

**Acceptance Scenarios**:

1. **Given** membro em time com `placement = 1` numa edição, **When** visitante abre o perfil, **Then** a entrada da edição mostra chip `1º lugar` em lendário linkando pra `/h/[id]`
2. **Given** membro inscrito numa edição sem entrar em time, **When** o perfil renderiza, **Then** a entrada mostra `participou` em muted
3. **Given** membro em time `placement = 0` com projeto entregue, **When** o perfil renderiza, **Then** a entrada mostra `entregou projeto` em accent
4. **Given** membro com participações em 3 edições, **When** o perfil renderiza, **Then** as entradas aparecem da edição mais antiga pra mais nova
5. **Given** membro sem nenhuma participação, **When** o perfil renderiza, **Then** a seção "// trajetória" não aparece (as demais seções ficam intactas)

---

### User Story 2 - Linha-resumo consolida o arco (Priority: P2)

Acima da faixa de edições, uma linha-resumo quantifica o arco: `{n} edições · {wins} pódios · {projects} projetos entregues` — contagem de edições, de pódios (placement 1–3) e de projetos entregues (time com `team_projects`).

**Why this priority**: O resumo é a versão de uma linha do "competed 4x" — quem escaneia o perfil lê o placar antes dos detalhes.

**Independent Test**: Membro com 3 edições, 1 pódio e 2 projetos → a linha mostra `3 edições · 1 pódio · 2 projetos entregues`.

**Acceptance Scenarios**:

1. **Given** membro com N edições, W pódios e P projetos, **When** o perfil renderiza, **Then** a linha mostra os três números com plural correto em pt-BR (`1 edição`, `1 pódio`, `1 projeto entregue`)
2. **Given** membro sem pódio e sem projeto, **When** renderiza, **Then** a linha mostra `0 pódios · 0 projetos entregues` sem esconder as edições

---

### Edge Cases

- Membro em time de edição em que **não se inscreveu** (vínculo direto via admin/arquivo): a edição entra no arco — participação é inscrição **ou** time
- Membro inscrito **e** em time na mesma edição: uma entrada só, com os dados do time (sem duplicar a edição)
- Time sem projeto: `entregou projeto` só aparece quando existe linha em `team_projects`; time sem entrega cai pra `participou`
- `placement` fora de 1–3 (não acontece pelo admin — select fixo): tratado como sem pódio
- Edição inativa/futura com inscrição: conta no arco do mesmo jeito (a trajetória inclui a campanha em curso)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `getMemberArc(username)` em `lib/archive.ts` retorna lista ordenada `MemberArcEntry[]` (`hackathonId`, `hackathonName`, `startsAt`, `teamId`, `teamName`, `placement`, `hasProject`), uma entrada por edição participada, **da mais antiga pra mais nova** (`startsAt ASC`)
- **FR-002**: participação = `registrations` (via `memberId` do username) **OU** `team_members` (via username) — união das duas fontes, sem duplicar edição
- **FR-003**: quando o membro tem time na edição, `placement`/`hasProject`/`team*` vêm do time; sem time, `placement = 0`, `hasProject = false`, `teamId/teamName = null`
- **FR-004**: sem participações, `getMemberArc` retorna `[]` — a página decide não renderizar
- **FR-005**: `/u/[username]` renderiza a seção "// trajetória" **antes** da seção de projetos, somente quando `arc.length > 0`: faixa horizontal de entradas (edição → chip de desfecho), cada uma link `/h/[id]`, com classes por desfecho — lendário/épico/raro pros pódios, accent pra entrega, muted pra participação
- **FR-006**: linha-resumo `"{n} edições · {wins} pódios · {projects} projetos entregues"` com plural pt-BR correto
- **FR-007**: nenhuma tabela nova — reusa `registrations`, `team_members`, `teams`, `team_projects`, `hackathons`, `members`

### Key Entities

- Reusa as de 003/021. Novo conceito: **arco** = união ordenada de inscrições e times do membro; **desfecho** = função de `(placement, hasProject)` → pódio | entregou | participou.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Qualquer perfil com ≥1 participação mostra a trajetória completa em uma faixa, sem scroll vertical extra por edição
- **SC-002**: 100% das edições participadas aparecem — inscrição sem time nunca é escondida (é o "participou" que conta a persistência)
- **SC-003**: Ordem cronológica garantida por teste unitário (inserção fora de ordem não muda a render)
- **SC-004**: Perfil vazio de histórico não renderiza a seção nem quebra as seções existentes

## Assumptions

- "Participou" = inscrição ou vínculo de time sem pódio e sem projeto — a barra é baixa de propósito: presença já é trajetória
- Um membro = um time por edição (invariante de 021); se dados legados violarem, a query pega o time de melhor colocação deterministicamente
- A faixa é horizontal com wrap — edições muitas viram segunda linha, não scroll lateral
- Chips linkam sempre pra `/h/[id]` (a edição é o destino; o projeto já tem link próprio na seção de projetos)
