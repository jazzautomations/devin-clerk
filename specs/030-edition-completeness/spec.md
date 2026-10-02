# Feature Specification: Completude da Edição — ongoing na página + submissão rica

**Feature**: `030-edition-completeness`
**Created**: 2026-10-02
**Status**: Draft
**Input**: Duas lacunas ligadas à completude da edição. (A) O spec 027 definiu "aberto" = não encerrado (`COALESCE(endsAt, registrationDeadline, startsAt) < now`), mas `/h/[id]` ainda calcula `past` por `startsAt` — um evento EM ANDAMENTO (janela Devpost aberta, `endsAt` futuro) cai em modo arquivo: some a faixa de arena, a seção de inscritos e o "meu time", e a página se intitula "// arquivo". O próprio edge case de 027 deixou a página pra v2 — esta é a v2. (B) A submissão do Colosseum tem pitch em vídeo e logo do projeto; o nosso `team_projects` só guarda título/descrição/repo/demo — a ficha `/p/[teamId]` não pode mostrar "▶ vídeo" nem o card de `/projetos` o logo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Página da edição em andamento fica "viva" (Priority: P1)

Quem abre `/h/[id]` de um evento que já começou mas não acabou (Devpost de 30 dias, `endsAt` futuro) vê a página no modo live: faixa de arena com fase **"em andamento"** e countdown pro fim ("termina em"), inscritos, board de times, "meu time" e CTA de inscrição seguem as regras de edição aberta. A seção "resultado" só aparece se houver arquivo — nunca pelo `startsAt` passado sozinho.

**Why this priority**: É o bug — metade dos eventos ativos (spec 027) renderiza como se tivesse acabado: some o CTA de inscrição e o formulário de time justo quando a janela de submissão tá aberta. Página de evento rolando que diz "edição encerrada" espanta quem chegou pra participar.

**Independent Test**: Evento `startsAt` há 3 dias + `endsAt` em 10 dias → `GET /h/[id]` mostra a faixa de arena ("em andamento"), não mostra o heading "resultado" e lista inscritos.

**Acceptance Scenarios**:

1. **Given** evento ongoing (`startsAt` passado, `endsAt` futuro), **When** abre `/h/[id]`, **Then** vê a faixa de arena com fase "em andamento" e countdown "termina em" apontando pro `endsAt`; heading "resultado" ausente (sem arquivo)
2. **Given** evento ongoing sem `endsAt` mas com `registrationDeadline` futuro (proxy de fim, spec 027), **When** abre a página, **Then** faixa presente com countdown "inscrições fecham em" apontando pro deadline
3. **Given** evento encerrado (`COALESCE` passado), **When** abre a página, **Then** modo arquivo como hoje: sem faixa, "// arquivo" no topo, "resultado" presente
4. **Given** evento futuro, **When** abre a página, **Then** comportamento atual intacto (fase open/closed-soon/live, countdown "começa em"/"inscrições fecham em")
5. **Given** evento ongoing com `registrationDeadline` já passado mas `endsAt` futuro, **When** abre a página, **Then** segue ongoing — `endsAt` vence o deadline na regra COALESCE; linha de inscrições mostra "encerradas"

---

### User Story 2 - Projeto guarda vídeo de pitch e logo (Priority: P1)

`team_projects` ganha `videoUrl` e `logoUrl` (nullable — migração `ALTER` guardado em `lib/archive.ts`, `lib/db.ts` intocado). A submissão self-service aceita os dois campos: `submitTeam` (POST) e `updateTeamProject` (PATCH) validam `http(s)` igual `repoUrl`. Nada novo no cadastro admin (003) — ele continua preenchendo os 4 campos originais.

**Why this priority**: O pitch do Colosseum é vídeo + logo — sem as colunas, nem API nem UI têm onde guardar; o campo precisa existir antes de qualquer superfície usá-lo.

**Independent Test**: `POST /api/hackathons/[id]/team` com `project.videoUrl`/`logoUrl` http(s) → 201 e `getArchive` devolve os campos; `videoUrl: "javascript:…"` → 400.

**Acceptance Scenarios**:

1. **Given** inscrito submetendo time, **When** envia `project` com `videoUrl`/`logoUrl` http(s), **Then** 201 e o projeto persiste os dois campos (vazios → NULL)
2. **Given** integrante editando, **When** envia `PATCH` com `videoUrl`/`logoUrl`, **Then** 200 com os campos atualizados; string vazia limpa (NULL) como os demais opcionais
3. **Given** qualquer rota, **When** `videoUrl`/`logoUrl` não-http(s) (`javascript:`, `ftp:`), **Then** 400 — mesma regra do `repoUrl`
4. **Given** projeto criado antes da migração (ou admin via `createTeam`), **When** lido por `getArchive`/`getMemberProjects`/`getProjectByTeamId`/`listProjects`, **Then** `videoUrl`/`logoUrl` vêm `null` — nunca undefined nem erro de coluna

---

### User Story 3 - Formulário, ficha e card mostram os campos novos (Priority: P2)

O "meu time" ganha dois campos opcionais (vídeo, logo) nos formulários de criar e editar. `/p/[teamId]` mostra link `▶ vídeo` ao lado de repo/demo (link externo, sem embed). O card de `/projetos` mostra o logo em thumb 32px quando `logoUrl` existe — sem logo, o card fica como hoje. OG image do projeto não muda.

**Why this priority**: As colunas sem superfície são invisíveis; mas a migração+API já destravam teste e uso por outros meios — a UI é a última milha, não o risco.

**Independent Test**: Time com `videoUrl`/`logoUrl` seedados → `/p/[teamId]` renderiza `▶ vídeo` com href correto e `/projetos` mostra `img` 32px; time sem logo → card sem `img`.

**Acceptance Scenarios**:

1. **Given** membro inscrito sem time, **When** abre o form "meu time", **Then** vê campos "vídeo (url)" e "logo (url)" opcionais após repo/demo
2. **Given** membro com time+projeto, **When** abre "editar projeto", **Then** os campos vêm preenchidos com os valores salvos e o PATCH os persiste
3. **Given** projeto com `videoUrl`, **When** visitante abre `/p/[teamId]`, **Then** vê o link `▶ vídeo` (externo, `target="_blank"`) junto de repo/demo; projeto só com vídeo (sem repo/demo) não cai no estado "sem links públicos"
4. **Given** projeto com `logoUrl`, **When** `/projetos` lista, **Then** o card mostra thumb 32px; sem `logoUrl` nenhum `img` renderiza
5. **Given** `/p/[teamId]` com os campos novos, **When** gera og-image, **Then** imagem inalterada (título/edição/colocação apenas)

---

### Edge Cases

- `endsAt == now` exato: ainda não acabou (fronteira `<` estrita, mesma de `isOver`) → ongoing, countdown em 00:00:00:00 até passar
- `endsAt` inválida (NaN): `isOver` trata como "não encerrado" → ongoing se `startsAt` passou; countdown fica sem alvo válido → faixa não renderiza (dado ruim não inventa relógio)
- Evento sem `endsAt` com `registrationDeadline` passado: `COALESCE` diz encerrado → modo arquivo (deadline é proxy de fim — spec 027); o campo `live`/closed-soon só se sustenta com `endsAt` válido futuro
- `archived` continua `endsAt efetivo + 7d` — a grace agora mede do fim efetivo (COALESCE), não só de `endsAt`
- `videoUrl`/`logoUrl` com espaços: trim antes de validar/gravar (mesmo tratamento de `repoUrl`)
- Campo omitido no PATCH (`undefined`) não toca a coluna; `""`/`null` explícito limpa — simetria total com `repoUrl`/`demoUrl`
- Logo quebrada/404 remoto: `<img>` falha quieto no navegador — sem fallback custom (decisão: não inventar placeholder)
- Emblema do card de `/projetos`: logo nunca acompanha selo de pódio — são cantos distintos do card

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/h/[id]` define `past = isOver(h, now)` — mesma fronteira `COALESCE(endsAt, registrationDeadline, startsAt) < now` de 027; todo gate da página (`past ? "// arquivo" : "// hackathon"`, faixa, CTA, "meu time", board, "resultado") herda a regra sem mais mudança
- **FR-002**: `editionPhase` ganha a fase `ongoing`: `startsAt <= now` E não-encerrado (fim efetivo no futuro/NaN) → `ongoing`; encerrado dentro da grace → `ended`; após `endRef + ARCHIVE_GRACE_MS` → `archived`. `endRef = endsAt ?? registrationDeadline ?? startsAt`
- **FR-003**: `countdownTarget` para `ongoing` → `{iso: endsAt, kind: "end"}` quando `endsAt` futuro; senão `deadline` futuro → `kind: "deadline"`; sem alvo → null. `ended`/`archived` seguem sem alvo
- **FR-004**: Faixa da arena em `/h/[id]`: `PHASE_LABEL.ongoing = "em andamento"` com a classe da fase `live` (acento pulsante); label do countdown `"end"` → "termina em"; dígitos em acento para `live`/`ongoing`
- **FR-005**: `team_projects.videoUrl`/`logoUrl` `TEXT` nullable via `PRAGMA table_info` + `ALTER TABLE` no topo de `lib/archive.ts` (padrão do próprio arquivo; `lib/db.ts` NÃO é tocado)
- **FR-006**: `TeamProject` expõe `videoUrl`/`logoUrl: string | null`; `getArchive`, `getMemberProjects`, `getProjectByTeamId` e `listProjects` selecionam e propagam as duas colunas
- **FR-007**: `submitTeam`/`updateTeamProject` aceitam `videoUrl`/`logoUrl` no projeto/patch — trim + `http(s)` obrigatório quando não-vazio (mesmo `httpUrl`/`TeamError` de `repoUrl`); INSERT/UPDATE cobrem as colunas; `createTeam` (admin) inalterado
- **FR-008**: `POST`/`PATCH /api/hackathons/[id]/team` repassam os campos — os guards (401/404/403/409) não mudam; 400 pra URL não-http(s)
- **FR-009**: `MyTeamPanel` — inputs "vídeo (url)" e "logo (url)" opcionais no create e no edit; `openEdit` hidrata dos valores salvos; payload inclui os campos
- **FR-010**: `/p/[teamId]` — `videoUrl` renderiza `▶ vídeo` externo junto a repo/demo e entra na condição "tem links"; `/projetos` — `logoUrl` renderiza `<img>` 32×32 no card; og-image e demais superfícies inalteradas

### Key Entities

- **TeamProject** ganha `videoUrl`/`logoUrl` (1:1 com o time, nullable) — pitch em vídeo e identidade visual, estilo portal Colosseum.
- **EditionPhase** ganha `ongoing` — "começou e não acabou", entre `live` (quase lá) e `ended` (acabou, em grace). O resto do modelo (`teams`, `registrations`) intacto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos eventos ongoing (não-encerrados com `startsAt` passado) renderizam `/h/[id]` em modo live — faixa de arena presente, "resultado" ausente salvo arquivo real
- **SC-002**: Nenhum evento encerrado perde o modo arquivo — complemento exato, mesma fronteira do radar
- **SC-003**: `videoUrl`/`logoUrl` fluem do POST ao card de `/projetos` e à ficha `/p` sem conversão manual — round-trip coberto por teste de API
- **SC-004**: 0 URLs não-http(s) persistidas nas colunas novas (400 garantido por teste em POST e PATCH)

## Assumptions

- "Encerrado" na página é a mesma fronteira do radar (027) — se o evento tá fora do radar, tá no arquivo; consistência entre listagem e detalhe é o contrato
- Fase `ongoing` é de exibição/contagem — não muda regra de inscrição (`registrationDeadline`/`isRegistrationClosed`), XP nem badges
- Vídeo é link externo (YouTube/Loom/etc.) — sem embed nem upload; logo é URL de imagem http(s) remota, sem proxy/otimização
- Admin (`createTeam`) não ganha os campos nesta spec — submissão rica é caminho do membro; admin cobre os campos se precisar numa spec própria
- `og-image`, `/u/[username]` e demais leituras de `TeamProject` ganham os campos no tipo mas não renderizam nada novo — superfícies novas são só `/p` (vídeo) e `/projetos` (logo)
