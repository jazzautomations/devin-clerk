# Feature Specification: Leaderboard de Membros

**Feature**: `007-leaderboard`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Gamificação do PRD (§5) — membros acumulam XP e níveis; `/membros` vira o ranking público da comunidade: quem tem mais XP aparece primeiro, pódio com destaque visual, cada linha prova atividade real (badges, campanhas, cartinhas)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante vê o ranking por XP (Priority: P1)

Qualquer pessoa (logada ou não) abre `/membros` e vê a comunidade ordenada por XP acumulado, do maior pro menor. Cada linha mostra posição (`#1`, `#2`, ...), nome/username com link pro perfil público, nível (chip LV + nome do nível), progresso de XP e as contagens que justificam a posição: badges, campanhas (hackathons inscritos) e cartinhas colecionadas.

**Why this priority**: É o coração da gamificação pública — ranking ordenado por XP transforma o diretório em competição saudável e prova social de quem mais constrói. Sem isso, XP existe mas ninguém vê.

**Independent Test**: Abrir `/membros` deslogado e ver lista numerada em ordem decrescente de XP, com `#1` no topo, sem precisar de login nem de outra feature.

**Acceptance Scenarios**:

1. **Given** membros com XP diferentes, **When** visitante abre `/membros`, **Then** a lista vem em ordem decrescente de XP com números de posição (#1, #2, #3...)
2. **Given** dois membros com o mesmo XP, **When** a lista renderiza, **Then** a ordem entre eles é determinística (username alfabético) — nunca aleatória a cada reload
3. **Given** um membro na lista, **When** visitante clica no nome/username, **Then** abre `/u/[username]`
4. **Given** cada linha, **When** renderiza, **Then** mostra chip de nível (LV + nome), XP, e contagens de badges/campanhas/cartinhas

---

### User Story 2 - Pódio tem distinção visual (Priority: P2)

Os 3 primeiros do ranking se destacam do resto da lista: o #1 recebe o tratamento **lendário** (dourado, mesmo token das cartinhas lendárias), #2 e #3 recebem acentos sutis (épico e raro respectivamente). Quem olha a página entende em segundos quem lidera.

**Why this priority**: Ranking sem pódio vira tabela — a distinção visual é o que dá status real ao topo e incentiva a caçar XP. Depende do P1 existir, mas é o que faz o leaderboard "ler" como leaderboard.

**Independent Test**: Com 3+ membros, os três primeiros `<li>` do ranking carregam classes/atributos de distinção diferentes das demais posições.

**Acceptance Scenarios**:

1. **Given** 3+ membros, **When** abre `/membros`, **Then** a linha do #1 usa o token `lendario` (borda/fundo dourado) e o número do rank aparece em dourado
2. **Given** 3+ membros, **When** abre `/membros`, **Then** #2 e #3 têm acento visual sutil (tokens `epico`/`raro`), sem pesar mais que o #1
3. **Given** ranking no modo "recentes", **When** abre `/membros?sort=recent`, **Then** posições aparecem sem cores de pódio (ordem cronológica não é mérito)

---

### User Story 3 - Ordenação alternativa por entrada recente (Priority: P3)

Um toggle no topo da página permite trocar a ordenação de "por xp" (padrão) para "recém-chegados" (createdAt desc) via `?sort=recent` — útil pra ver quem acabou de entrar na comunidade.

**Why this priority**: Nice-to-have. O ranking por XP já entrega o valor; a visão cronológica serve descoberta de novatos, não compete com o pódio.

**Independent Test**: `/membros?sort=recent` mostra o membro mais recente primeiro, sem destaque de pódio.

**Acceptance Scenarios**:

1. **Given** a página `/membros`, **When** visitante clica no toggle "recém-chegados", **Then** a URL vira `?sort=recent` e a lista reordena por data de entrada
2. **Given** `?sort=recent`, **When** visitante clica "por xp", **Then** volta ao ranking padrão
3. **Given** `?sort=<valor inválido>`, **When** abre a página, **Then** cai no ordenamento padrão por XP (nunca quebra)

---

### Edge Cases

- Comunidade vazia: mantém o empty state honesto ("ainda vazio — cria tua conta")
- Empate de XP: desempate determinístico por `username` ascendente — reload nunca embaralha
- `?sort=` com valor desconhecido: ignora e usa o padrão (xp)
- Membro com XP 0 no topo (comunidade zerada): ranking funciona igual, #1 ainda recebe destaque
- Poucos membros (< 3): só existem os destaques possíveis (ex.: com 2 membros, #1 lendário + #2 épico)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/membros` DEVE listar membros ordenados por `xp` decrescente, com desempate por `username` ascendente, ordenação feita no banco (ORDER BY)
- **FR-002**: Cada linha DEVE exibir: posição `#n`, username (link `/u/[username]`), nome/headline, chip de nível (LV + nome via `levelFor`), XP (barra ou contagem), nº de badges, nº de campanhas, nº de cartinhas
- **FR-003**: O #1 DEVE usar o token `lendario` (dourado); #2 e #3 DEVEM usar acentos sutis (`epico`/`raro`); demais posições ficam neutras
- **FR-004**: `?sort=recent` DEVE reordenar por `createdAt` desc (desempate `id` desc) e suprimir as cores de pódio; valor de `sort` inválido cai no padrão
- **FR-005**: A página DEVE continuar server component, pública (sem auth) e com empty state quando não houver membros
- **FR-006**: A landing `/` NÃO deve ser alterada — o leaderboard mora em `/membros`

### Key Entities

- **Member** (existente): `xp` já persiste na tabela `members`; nível é derivado via `levelFor(xp)` — nenhuma coluna nova
- **Leaderboard entry**: member + contagens derivadas (badges via `member_badges`, campanhas via `registrations`, cartinhas via `member_cards`)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `/membros` renderiza o membro de maior XP na posição #1 em 100% dos acessos (ordem determinística)
- **SC-002**: Visitante identifica o líder da comunidade em <5 segundos (destaque dourado sem scroll)
- **SC-003**: Recarregar a página nunca muda a ordem quando os dados não mudam
- **SC-004**: Nenhuma query de ranking executa ordenação em memória — ORDER BY no SQLite (índice não necessário no volume atual)

## Assumptions

- XP já existe e é mantido pelos fluxos atuais (inscrição, post, like, identidade) — a feature só lê
- Nível continua derivado de XP via `levelFor` — não vira coluna
- O pódio usa tokens de raridade existentes (`lendario`/`epico`/`raro`) — nenhum token novo no CSS
- Sem paginação em v1: `LIMIT` alto (100) cobre a comunidade atual; scroll infinito/busca ficam pra outra spec
- O diretório não tinha filtros de persona implementados — nada a preservar
