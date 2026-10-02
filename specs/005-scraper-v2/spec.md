# Feature Specification: Scraper v2 — Radar Externo Confiável

**Feature**: `005-scraper-v2`
**Created**: 2026-10-02
**Status**: Draft
**Input**: F3 do roadmap — o radar de hackathons externos (`npm run scrape` → `data/hackahub.db`) precisa de qualidade: sem duplicatas entre fontes, só hackathons de verdade, eventos passados fora do radar, e mais cobertura do Devpost/ETHGlobal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Radar sem duplicatas nem falsos positivos (Priority: P1)

Quem opera o HackaHub roda o scraper várias vezes (ou o agenda) e o banco não incha: o mesmo evento visto no Devpost e no TAIKAI (ou numa re-rodagem) vira **um** registro só, com a melhor ficha disponível. E eventos que não são hackathon (meetup, conferência, summit, workshop) não poluem o radar — o feed `/dashboard` e a landing mostram só maratonas reais.

**Why this priority**: Duplicata e falso positivo destroem a confiança no radar — é o bug mais visível pro usuário final ("vi o mesmo evento duas vezes" / "isso nem é hackathon").

**Independent Test**: Rodar `npm run scrape` duas vezes seguidas e contar: zero linhas novas na segunda, zero pares (nome+data) duplicados entre externos, zero itens com "meetup/summit" no nome sem "hack".

**Acceptance Scenarios**:

1. **Given** o mesmo evento raspado por duas fontes, **When** o scraper roda, **Then** existe uma única linha no banco para ele, com `source` refletindo as fontes combinadas ou a fonte primária
2. **Given** o mesmo evento já presente de uma rodagem anterior (id estável), **When** o scraper roda de novo, **Then** a linha é atualizada (não duplicada) e `last_seen` é renovado
3. **Given** evento "DevOps Summit" ou "Meetup de dados" raspado de fonte ruidosa (MLH/Meetup/curadoria), **When** o classificador roda, **Then** o item é descartado antes do upsert
4. **Given** evento com "hack" explícito no nome (ex.: "Hackathon STS 2026" num summit), **When** classificado, **Then** entra normalmente — termo de hack vence a denylist

---

### User Story 2 - Eventos passados saem do radar, ficam no arquivo (Priority: P1)

Evento cujo `endsAt` (ou `startsAt`, sem fim declarado) já passou é marcado `active=0` no upsert: some do radar de próximos, mas continua no banco como arquivo — nunca é apagado.

**Why this priority**: Radar com evento encerrado parece desatualizado; apagar a linha perde histórico e quebra `registrations`/`cards` que referenciam o evento.

**Independent Test**: Inserir via upsert um evento com `endsAt` em 2020 e um em 2999; consultar `active` de cada um (0 e 1).

**Acceptance Scenarios**:

1. **Given** evento raspado com `endsAt` no passado, **When** entra no upsert, **Then** grava com `active=0`
2. **Given** evento externo já no banco cuja data passou desde a última rodagem, **When** o scraper roda, **Then** um sweep final marca `active=0` mesmo que a fonte não o retorne mais
3. **Given** evento da comunidade (sem `source`), **When** qualquer passo roda, **Then** ele nunca é desativado nem alterado pelo scraper

---

### User Story 3 - Devpost além dos destaques e ETHGlobal resiliente (Priority: P2)

O scraper pagina a API do Devpost (até ~5 páginas, com pausa entre chamadas) e traz dezenas de hackathons abertos em vez dos ~9 featured. O ETHGlobal usa o markdown do Jina com parser robusto ao formato de card atual (`### Nome Data… Data… Tipo](url)`); se vier vazio, tenta endpoints JSON conhecidos e, persistindo o zero, loga "degraded" com clareza em vez de falhar ou inventar dado.

**Why this priority**: Cobertura — Devpost é a maior fonte ocidental de hackathons e estava limitada a 1 página; ETHGlobal é a referência web3 e estava instável. Mas P1 vem primeiro: volume sem qualidade só amplifica o ruído.

**Independent Test**: Rodada real retorna >9 linhas do Devpost; ETHGlobal retorna ≥0 com log honesto do resultado (nunca exceção não tratada, nunca evento fabricado).

**Acceptance Scenarios**:

1. **Given** a API do Devpost com `total_count` > `per_page`, **When** o scraper roda, **Then** pagina até esgotar ou atingir 5 páginas
2. **Given** markdown do Jina com cards tipados, **When** o parser roda, **Then** só cards tipo "Hackathon" entram, com nome e datas corretos (não o nome do card seguinte)
3. **Given** Jina fora do ar ou layout mudou, **When** o parser retorna 0, **Then** o log diz "degraded" e a curadoria segue cobrindo ETHGlobal

---

### Edge Cases

- Mesmo nome em datas diferentes = edições distintas → não deduplicar (chave inclui a data de início)
- Evento raspado cuja chave (nome+data) coincide com evento da comunidade (sem `source`) → o raspado não é inserido; o da comunidade é autoridade
- Evento externo já no banco com id diferente mas mesma chave do vencedor do dedupe → o antigo é desativado (active=0), nunca apagado
- `first_seen`/`last_seen` nulos em bancos antigos → migração faz backfill
- Colunas novas em banco já existente → `ALTER TABLE` idempotente via `PRAGMA table_info` (mesmo pattern de `lib/db.ts`)
- Fonte fora do ar/timeout → exceção daquela fonte não derruba as demais (comportamento já existente, mantido)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O scraper DEVE calcular `dedupe_key` = (nome normalizado lowercase sem não-alfanuméricos) + data de `startsAt` (YYYY-MM-DD) e deduplicar os eventos coletados antes do upsert
- **FR-002**: No merge de duplicatas DEVE prevalecer a ficha com mais metadados (campos preenchidos + tags); campos vazios do vencedor podem ser preenchidos pelos perdedores; `source` registra as fontes combinadas
- **FR-003**: `is_hackathon(name, tags, description)` DEVE rejeitar itens com palavra da denylist (conference, summit, congresso, meetup, talk, workshop, feira, webinar, co-working…) **a menos** que contenha termo de hack (hack, datathon, buildathon, ideathon, makeathon, gamejam…) no nome/tags/descrição; sem denylist e sem hack-term → aceito
- **FR-004**: O filtro DEVE rodar nas fontes ruidosas (MLH, Meetup, Luma, curadoria); Devpost e TAIKAI são inerentemente hackathons; ETHGlobal filtra pelo tipo do card
- **FR-005**: Upsert DEVE gravar `active=0` quando `endsAt` (ou `startsAt` sem fim) está no passado, e um sweep final DEVE desativar externos expirados ainda ativos — nunca linhas sem `source`
- **FR-006**: Devpost DEVE paginar `GET /api/hackathons` com `page`/`per_page` até `total_count` ou máx. 5 páginas, com pausa ≥1s entre páginas
- **FR-007**: ETHGlobal DEVE tentar Jina markdown com parser dos cards tipados, fallback pra endpoints JSON conhecidos; 0 resultados → log "degraded", nunca dado inventado
- **FR-008**: O schema DEVE ganhar colunas `first_seen`/`last_seen` (TEXT ISO) via migração idempotente no início do scraper; insert grava ambas, update renova só `last_seen`
- **FR-009**: Eventos da comunidade (`source IS NULL`) NUNCA são desativados nem sobrescritos pelo scraper
- **FR-010**: O scraper DEVE imprimir contagem por fonte (coletados → mantidos após dedupe) e total — incluindo zeros honestos

### Key Entities

- **Hackathon (linha raspada)**: campos existentes + `source` combinada + `first_seen`/`last_seen`; identidade de negócio = `dedupe_key`, identidade física = `id` estável por fonte
- **Fonte (source)**: função pura `src_*() -> list[dict]`; falha isolada vira `[fail]` no log

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Duas rodadas consecutivas produzem o mesmo número de linhas externas (segunda rodada adiciona 0)
- **SC-002**: Zero pares de linhas externas ativas com mesmo (nome normalizado, data de início)
- **SC-003**: Devpost retorna >9 eventos numa rodada real (vs. ~9 featured de hoje)
- **SC-004**: 100% dos itens com denylist-word e sem hack-term são rejeitados nos testes; eventos expirados ficam `active=0`
- **SC-005**: Todas as fontes reportam contagem honesta — Luma/ETHGlobal podem ser 0, mas logado como tal, sem exceção não tratada

## Assumptions

- `dedupe_key` usa o dia local da string ISO de `startsAt` (prefixo de 10 chars) — fuso exato é refinamento futuro
- "Mais metadados" = contagem de campos preenchidos + nº de tags, com desempate pra `curadoria` (verificada à mão)
- O scraper não reconcilia com eventos da comunidade além de *não duplicar*: enriquecer ficha da comunidade é decisão editorial, fora do escopo
- Luma segue geogated (API interna exige `place_id` real) — aceito como limitação conhecida, mantido o código pra quando resolver
- Sem pytest na venv: testes são asserts puros rodando via `uv run --python .venv-scraper/bin/python scripts/test_scrape_radar.py` (`npm run test:scrape`)
