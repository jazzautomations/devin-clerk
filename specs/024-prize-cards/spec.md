# Feature Specification: Prêmio nos Cards do Radar

**Feature**: `024-prize-cards`
**Created**: 2026-10-02
**Status**: Draft
**Input**: O estudo de referências (000-refs-study) mostrou que o card do Devpost lidera com "$138,000 in prizes" — prêmio vende o clique. Nossos cards do radar (`HackathonCard`) mostram data, local e inscrições, mas nenhum prêmio: o scraper já captura `prize_amount` do Devpost e `prize` do TAIKAI, porém joga tudo numa tag `premio-*` ilegível (`#premio-$138,000`) em vez de guardar num campo próprio. Aqui o prêmio vira coluna de verdade, entra no merge/upsert do scraper e aparece em destaque no card e na imagem social da edição.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante vê o prêmio no card do radar (Priority: P1)

Quem abre `/radar` vê, nos eventos com prêmio conhecido, o valor em destaque na cor lendária — "R$ 15 mil", "$138,000", "€20,000" — direto no card, antes de clicar. Evento sem prêmio conhecido simplesmente não mostra a linha (sem "—", sem placeholder).

**Why this priority**: É a informação que mais puxa clique no discovery (lição do Devpost no estudo). Sem ela no card, o dado raspado morre numa tag feia que ninguém filtra.

**Independent Test**: Seed/evento raspado com `prize` → `/radar` renderiza o valor exatamente como armazenado, em `text-lendario`, dentro do `<article>` do evento; evento sem `prize` não renderiza a linha "prêmio".

**Acceptance Scenarios**:

1. **Given** um hackathon ativo com `prize = "R$ 42 mil"`, **When** `/radar` renderiza, **Then** o card do evento mostra "R$ 42 mil" com ênfase lendária ao lado da área data/inscrições
2. **Given** um hackathon sem `prize` (NULL), **When** o card renderiza, **Then** nenhuma linha "prêmio" aparece e o layout não quebra
3. **Given** o valor armazenado, **When** exibido, **Then** aparece verbatim — a UI nunca parseia nem reformata o texto

---

### User Story 2 - Scraper popula `prize` das fontes que publicam (Priority: P1)

O pipeline (`scrape_radar.py`) extrai a string de display do prêmio quando a fonte publica: Devpost `prize_amount` (HTML embutido, ex.: `"$<span …>138,000</span>"` → `"$138,000"`) e TAIKAI `prize` + `prizeCurrency.name` (ex.: `20000` + `EUR` → `"€20,000"`). Prêmio zero/ausente vira NULL, nunca "$0". O merge de duplicatas mantém o prêmio (registro mais rico vence; perdedor preenche vazio) e o upsert grava/atualiza a coluna.

**Why this priority**: Sem o scraper alimentando, a coluna fica vazia e a US1 vira enfeite — a fonte de verdade do prêmio é o pipeline.

**Independent Test**: `npm run test:scrape` cobre extração (devpost/taikai/curadoria), merge preservando prêmio e upsert gravando a coluna; uma rodada real aumenta o nº de eventos com `prize` no banco.

**Acceptance Scenarios**:

1. **Given** payload Devpost `prize_amount = "$<span data-currency-value>138,000</span>"`, **When** `src_devpost` processa, **Then** a linha sai com `prize = "$138,000"`
2. **Given** `prize_amount` vazio, `"$0"` ou ausente, **When** processa, **Then** `prize` fica `None` (nunca exibe "grátis" nem "$0")
3. **Given** challenge TAIKAI `prize=20000, prizeCurrency.name="EUR"`, **When** `src_taikai` processa, **Then** sai `prize = "€20,000"`; `prize=0` → `None`
4. **Given** duas fontes raspando o mesmo evento e só uma traz prêmio, **When** `dedupe`/`merge_rows` roda, **Then** o vencedor final carrega o prêmio
5. **Given** linha raspada com prêmio, **When** `upsert` grava (insert ou update), **Then** `hackathons.prize` reflete o valor

---

### User Story 3 - Imagem social da edição cita o prêmio (Priority: P2)

O OG dinâmico `/h/[id]/opengraph-image` inclui o prêmio na linha de detalhe quando a edição tem — compartilhar o link já vende o valor.

**Why this priority**: O link compartilhado é o segundo ponto de venda do evento; prêmio no card social amplifica o alcance de cada divulgação.

**Independent Test**: Edição com `prize` → GET do opengraph-image retorna 200 PNG com o valor na linha de detalhe (verificável por snapshot/HTML do ImageResponse); edição sem prêmio renderiza igual a hoje.

**Acceptance Scenarios**:

1. **Given** edição com `prize = "R$ 5 mil"`, **When** o OG renderiza, **Then** a linha de detalhe termina com o valor do prêmio separado por "·"
2. **Given** edição sem `prize` ou id fantasma, **When** o OG renderiza, **Then** responde 200 com a linha de detalhe atual (data · local · formato)

---

### User Story 4 - Operação edita o prêmio pelo admin (Priority: P3)

O organizador corrige/define prêmio numa edição pela API admin já existente — prêmio de edição da comunidade é curadoria, não scrape.

**Why this priority**: Edições da casa não vêm de scraper; sem PATCH o prêmio delas só nasce por seed. P3 porque a correção manual é rara.

**Independent Test**: `PATCH /api/admin/hackathons/[id]` com `{prize: "R$ 10 mil"}` → 200 e `GET` reflete; `prize: null` limpa.

**Acceptance Scenarios**:

1. **Given** admin, **When** PATCH `{prize: "R$ 10 mil"}`, **Then** 200 e a edição passa a mostrar o valor
2. **Given** admin, **When** PATCH `{prize: null}`, **Then** o campo é limpo
3. **Given** `prize` com tipo errado (número/objeto), **When** PATCH, **Then** 400

---

### Edge Cases

- Devpost `prize_amount` com tags HTML internas (`<span data-currency-value>`) → strip de tags antes de guardar
- `prize_amount` `"$0"` ou só dígitos zerados → NULL (premiação zero não é argumento de venda)
- TAIKAI `prizeCurrency` ausente/desconhecida → display cai pro código (`"20,000 BRL"` style) — nunca inventa símbolo
- `prizes` do Devpost (campo separado) hoje vem sempre `null` na listagem — `prize_amount` é a fonte; defensivo se um dia vir dict
- Merge: vencedor sem prêmio herda do perdedor (mesmo fill de `endsAt`/`location`)
- Linhas antigas do banco (pré-coluna) → `prize` NULL, cards sem a linha — nada quebra

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `hackathons` ganha coluna `prize TEXT` nullable — `ALTER TABLE` idempotente guardado por `PRAGMA table_info` em `lib/db.ts` e no `ensure_schema` do scraper (mesmo pattern das migrações leves existentes)
- **FR-002**: `Hackathon` (lib/hackathons.ts) ganha `prize: string | null`; seeds de `data/hackathons.ts` declaram o campo; `hack-inova-unifacens-2026` recebe `"R$ 5 mil"` (dado real divulgado — spec 022) com backfill `UPDATE … WHERE prize IS NULL` que nunca sobrescreve valor existente
- **FR-003**: Scraper extrai display string: Devpost `prize_amount` (strip HTML, zero → None), TAIKAI `prize`+`prizeCurrency.name` (mapa de símbolo EUR→€/USD→$/BRL→R$, fallback código), curadoria declara `prize` quando conhecido (TJPA `"R$ 15 mil"`)
- **FR-004**: `metadata_score` conta `prize` e `merge_rows` preenche o campo vazio do vencedor a partir dos perdedores; `UPSERT_SQL` grava `prize` no INSERT e no `ON CONFLICT DO UPDATE`
- **FR-005**: `HackathonCard` mostra `prêmio` como linha do `<dl>` em `text-lendario` quando `prize` não-null — verbatim, sem parse
- **FR-006**: `opengraph-image` de `/h/[id]` adiciona `h.prize` à linha de detalhe quando presente
- **FR-007**: `HackathonPatch`/`updateHackathon` + `PATCH /api/admin/hackathons/[id]` aceitam `prize` (string não-vazia define, `null`/`""` limpa, tipo errado → 400); POST admin aceita `prize` opcional
- **FR-008**: Nenhuma tabela nova; tags `premio-*` continuam existindo (faceta de busca/filtro) — o chip é o display, a tag é a faceta

### Key Entities

- **Hackathon.prize**: string de display livre ("$138,000", "€20,000", "R$ 5 mil") — formato da fonte, nunca parseado pela UI

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos eventos raspados de fonte com prêmio público exibem o chip no radar
- **SC-002**: Uma rodada do scraper deixa ≥1 evento com `prize` preenchido por fonte que publica (devpost, taikai, curadoria-TJPA)
- **SC-003**: Card de evento sem prêmio renderiza idêntico a antes (nenhuma linha órfã)
- **SC-004**: OG de edição com prêmio responde 200 e cita o valor; sem prêmio, resposta inalterada

## Assumptions

- `prize` é texto de display — ordenar por valor numérico é feature futura (backlog "prize sort/filtro" do estudo)
- Moeda do TAIKAI vem de `prizeCurrency.name`; símbolo só pros códigos mapeados
- Prêmio de edição da comunidade (seed/admin) é dado curado — o scraper só escreve em linhas `source IS NOT NULL` (regra já existente vale pra coluna nova)
- Devpost `prize_amount` é sempre string HTML-ish ou vazio; `prizes` não é usado (sempre null na listagem hoje)
