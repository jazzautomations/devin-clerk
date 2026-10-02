# Feature Specification: Arena ao Vivo

**Feature**: `016-live-arena`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Página de edição estilo coliseu — uma edição futura deve parecer VIVA, não um cartaz parado: fase da arena, relógio contando e prova social (inscritos) em cima da dobra.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante sente a arena viva numa edição futura (Priority: P1)

Alguém abre `/h/[id]` de uma edição futura e, antes de rolar, vê a faixa de arena: a fase atual ("inscrições abertas" / "inscrições encerradas" / "começando"), um relógio `DD:HH:MM:SS` tickando a cada segundo rumo ao alvo certo, e quanta gente já tá dentro ("N inscritos", com "N procurando time" quando houver board). É a diferença entre "site do evento" e "arena que vai acontecer".

**Why this priority**: É o núcleo da feature — urgência real, ao vivo, na página que já é a mais importante do funil de inscrição.

**Independent Test**: Abrir `/h/hack-inova-alphaville-2026` deslogado e ver o countdown com dígitos `DD:HH:MM:SS` mudando + contagem de inscritos, sem login nem outra feature.

**Acceptance Scenarios**:

1. **Given** edição futura com inscrições abertas e `startsAt` a mais de 48h, **When** visitante abre `/h/[id]`, **Then** vê a faixa de arena com fase "inscrições abertas" (muda), countdown para o `startsAt` e "N inscritos"
2. **Given** edição com `startsAt` em ≤48h e inscrições abertas, **When** visitante abre a página, **Then** a fase é "começando" em destaque (acento, pulsando)
3. **Given** edição futura com `registrationDeadline` já passado, **When** visitante abre a página, **Then** a fase é "inscrições encerradas" (lendário) e o countdown segue pro `startsAt`
4. **Given** edição passada (`startsAt` ≤ agora), **When** visitante abre a página, **Then** NÃO vê faixa de arena — a página segue exatamente como hoje (modo arquivo)

---

### User Story 2 - O relógio aponta pro alvo certo (Priority: P1)

Quando o `registrationDeadline` existe, está no futuro e é anterior ao `startsAt`, o countdown aponta pro deadline com o rótulo "inscrições fecham em" — a urgência real é a inscrição, não o evento. Passado o deadline (ou se não houver), o relógio conta pro `startsAt` com "começa em".

**Why this priority**: Contar pro alvo errado é pior que não contar — inscrição fechando é o gargalo do funil; começo do evento é o hype.

**Independent Test**: Edição com deadline daqui 12h e `startsAt` daqui 10 dias → countdown marca ≤12h e rótulo "inscrições fecham em"; edição sem deadline → rótulo "começa em".

**Acceptance Scenarios**:

1. **Given** deadline futuro anterior ao `startsAt`, **When** a faixa renderiza, **Then** o countdown aponta pro deadline com rótulo "inscrições fecham em"
2. **Given** deadline já passado ou inexistente, **When** a faixa renderiza, **Then** o countdown aponta pro `startsAt` com rótulo "começa em"
3. **Given** alvo já vencido (edge: deadline no passado exato do render), **When** o countdown renderiza, **Then** mostra `00:00:00:00`, nunca número negativo

---

### User Story 3 - Render SSR-safe sem flash nem mismatch (Priority: P2)

O countdown renderiza no HTML do servidor com o valor correto daquele instante e passa a tickar no cliente — sem hydration mismatch, sem piscar `--:--:--:--`.

**Why this priority**: A página é pública e indexada; um relógio que pisca ou quebra o hydrate derruba a credibilidade da "arena ao vivo".

**Independent Test**: `curl` na página já traz dígitos `DD:HH:MM:SS` no HTML; no browser o valor continua e ticka sem erro de hydration no console.

**Acceptance Scenarios**:

1. **Given** a página renderizada no servidor, **When** o HTML chega, **Then** o countdown já contém dígitos (não placeholder)
2. **Given** o cliente hidratado, **When** passa 1s+, **Then** os dígitos atualizam sem warning de hydration

---

### Edge Cases

- `startsAt` exatamente agora → já é passado (`ended`): página em modo arquivo, sem faixa
- `startsAt - now` exatamente 48h → `live` (janela inclusiva)
- `registrationDeadline` exatamente agora → ainda conta como aberto (fecha quando `deadline < now`), coerente com `isRegistrationClosed`
- `endsAt` nulo → a janela pós-evento usa `startsAt` como referência
- Fuso: todas as datas são ISO com offset; a lógica compara instants, não datas locais
- `startsAt` inválido/ausente não acontece (coluna NOT NULL no seed), mas `countdownParts` com alvo inválido devolve zeros em vez de NaN

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/h/[id]` de edição NÃO passada DEVE exibir uma faixa de arena perto do topo com: rótulo de fase, countdown e "N inscritos" (+ "N procurando time" quando houver board)
- **FR-002**: A fase DEVE ser derivada puramente de `startsAt`, `endsAt`, `registrationDeadline` e `now`, em uma destas: `open`, `closed-soon`, `live`, `ended`, `archived` — definição exata:

  | fase | condição (em ordem, primeira que bate) |
  |---|---|
  | `archived` | `now ≥ startsAt` e `now > (endsAt ?? startsAt) + 7 dias` — virou história |
  | `ended` | `now ≥ startsAt` — evento começou/rolando/recém-terminado; página em modo arquivo (comportamento atual) |
  | `live` | `startsAt - now ≤ 48h` E inscrição aberta — "começando" |
  | `closed-soon` | inscrição fechada (`deadline < now`) e evento ainda futuro — "inscrições encerradas, chegando" |
  | `open` | resto — inscrições abertas, evento distante |

- **FR-003**: O countdown DEVE apontar pro `registrationDeadline` quando ele existir, estiver no futuro e for anterior ao `startsAt` (rótulo "inscrições fecham em"); caso contrário aponta pro `startsAt` (rótulo "começa em"); edição `ended`/`archived` não tem alvo
- **FR-004**: O countdown DEVE ser um componente client que renderiza o valor inicial do servidor (sem mismatch) e ticka a cada 1s, com dígitos `DD:HH:MM:SS` não-negativos (clamp em zero)
- **FR-005**: Edição passada NÃO DEVE mudar nada além de não mostrar a faixa — arquivo, carta, board e inscritos seguem iguais
- **FR-006**: O estilo da fase DEVE ser: `live` = acento pulsando; `closed-soon` = lendário; `open` = muted — tudo `font-mono`, coerente com a página

### Key Entities

- **EditionPhase**: união `'open' | 'closed-soon' | 'live' | 'ended' | 'archived'` — derivada, nunca persistida
- **CountdownTarget**: `{ iso, kind: 'deadline' | 'start' }` — o alvo e o rótulo do relógio
- **CountdownParts**: `{ d, h, m, s }` inteiros ≥ 0 — a decomposição do tempo restante

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `/h/hack-inova-alphaville-2026` mostra countdown com dígitos `DD:HH:MM:SS` no HTML e tickando no browser
- **SC-002**: Visitante entende em <5s quanto falta e quanta gente tá dentro ("N inscritos" visível sem scroll)
- **SC-003**: Zero hydration warnings no console ao abrir a edição
- **SC-004**: 100% das transições de fase cobertas por teste de unidade, incluindo os boundaries (48h exatas, `startsAt` exato, deadline exato, +7d de grace)

## Assumptions

- Fase é função pura de `(hackathon, now)` — sem banco, sem relógio de parede embutido: testável e SSR-determinístico
- Janela de `live` = 48h ("fim de semana do evento") e grace de `archived` = 7 dias pós-`endsAt` são decisões de produto desta spec, ajustáveis num lugar só (`lib/arena.ts`)
- `ended` e `archived` renderizam igual hoje (modo arquivo) — a distinção existe na fase para futuras nuances (ex.: "resultado fresco" vs. histórico)
- "N inscritos" usa a lista já carregada pela página; sem query nova
- Se a edição não for partner (link externo), a faixa aparece igual — urgência vale pro radar também
