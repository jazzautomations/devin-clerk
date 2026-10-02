# Feature Specification: Talento — diretório de quem entrega

**Feature**: `014-talento`
**Created**: 2026-11-02
**Status**: Draft
**Input**: Monetização #3 do PRD — "Talento: recrutadores pagam acesso ao diretório curado". Participante nunca paga; quem paga é a empresa que quer alcançar quem constrói e entrega em hackathon.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Empresa/visitante explora o diretório público (Priority: P1)

Uma empresa, recrutador ou investidor abre `/talento` e vê a lista de membros que se declararam disponíveis ("open to") — com nome, perfil, persona, nível/XP, skills, o que a pessoa busca e a prova: quantos projetos entregou em hackathon e a melhor colocação ("1º lugar · edição X"). É a superfície comercial da plataforma: "essas pessoas entregaram em hackathon — contrate quem prova".

**Why this priority**: É a feature que monetiza — o diretório público é a vitrine que justifica o tier comercial futuro. Sem a página, o opt-in não tem onde aparecer.

**Independent Test**: Abrir `/talento` deslogado e ver membros com `openTo` marcado, ordenados por XP, cada um com chips de interesse e prova de entrega — sem login nem outra feature.

**Acceptance Scenarios**:

1. **Given** membros com `openTo` preenchido, **When** visitante abre `/talento`, **Then** vê a lista ordenada por XP desc, cada linha com nome/@username linkando pro perfil, chips de openTo em destaque (acento), skills, LV/xp e contagem de projetos entregues
2. **Given** membro com pódio no arquivo, **When** a linha renderiza, **Then** mostra a melhor colocação com o nome da edição ("1º lugar · Hackathon Inova AI × Payment Shift")
3. **Given** membro com github cadastrado, **When** a linha renderiza, **Then** há link pro github externo
4. **Given** ninguém opted-in, **When** visitante abre `/talento`, **Then** vê empty state honesto convidando a marcar "open to" no próprio perfil — nunca quebra nem inventa dado
5. **Given** membro sem `openTo` (NULL ou vazio), **When** a página lista, **Then** ele NÃO aparece — o diretório é opt-in, não diretório geral

---

### User Story 2 - Membro declara "open to" no próprio perfil (Priority: P1)

O membro logado abre `/perfil`, marca como quer ser abordado por empresas — trampo, cofundador, freela e/ou mentoria (multi-seleção) — e salva. A escolha persiste e passa a aparecer em `/talento`.

**Why this priority**: Sem o opt-in o diretório é vazio — é P1 junto com a vitrine. O campo é o consentimento comercial do membro.

**Independent Test**: PATCH `/api/members/me` com `{openTo: ["trampo","mentoria"]}` persiste e reflete em `/talento`; PATCH com valor fora do conjunto recebe 400.

**Acceptance Scenarios**:

1. **Given** membro logado, **When** marca "trampo" + "freela" no formulário de perfil e salva, **Then** `openTo` persiste e `/talento` passa a listá-lo com os dois chips
2. **Given** PATCH com `openTo` contendo valor fora da whitelist, **When** a API valida, **Then** responde 400 e não grava nada
3. **Given** membro opted-in que desmarca tudo, **When** salva com `openTo: []`, **Then** `openTo` volta pra NULL e ele sai de `/talento`
4. **Given** deslogado, **When** PATCH `/api/members/me`, **Then** 401 (comportamento já existente, não muda)

---

### Edge Cases

- `openTo` vazio (`""`) ou NULL: tratados igual — membro fora do diretório
- Lista com duplicatas (`["trampo","trampo"]`): grava deduplicado
- Valor fora da whitelist (ex.: `"famoso"`): 400, nada persiste — a whitelist é contrato comercial, não tag livre
- Membro com `openTo` mas zero projetos entregues: aparece mesmo assim — a prova é bônus, não pré-requisito; a linha mostra "0 projetos entregues" sem vergonha
- Membro apaga a conta: some da lista junto (query vive)
- Campo não vem no PATCH: `openTo` não é tocado (COALESCE lógico — PATCH parcial não reseta)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `members` DEVE ter coluna `openTo` (TEXT NULL, lista separada por vírgula), criada por migração idempotente própria em `lib/talent.ts` — sem tocar o schema principal de `lib/db.ts` (trabalho paralelo)
- **FR-002**: `PATCH /api/members/me` DEVE aceitar `openTo` como array de strings dentro da whitelist (`trampo`, `cofundador`, `freela`, `mentoria`); valor fora da lista → 400; ausência do campo → coluna preservada; array vazio → limpa (NULL)
- **FR-003**: `/perfil` DEVE expor o campo "open to" como multi-seleção visualmente consistente com o formulário existente
- **FR-004**: `/talento` DEVE ser página pública (server component, sem API nova) listando apenas membros com `openTo` preenchido, ordenados por XP desc
- **FR-005**: Cada linha DEVE mostrar nome/@username (link `/u/[username]`), chip de persona quando houver, LV/XP, skills, chips de openTo com o acento visual (sinal comercial), contagem de projetos entregues, melhor colocação com nome da edição e link github quando houver
- **FR-006**: Header DEVE linkar `/talento` na nav principal
- **FR-007**: Empty state DEVE ser honesto e apontar o caminho (marcar "open to" no `/perfil`)

### Key Entities

- **openTo** (coluna em `members`): TEXT NULL — valores da whitelist separados por vírgula; NULL/vazio = não opted-in
- **TalentEntry** (tipo de leitura): membro + `openTo[]` + `projects` (contagem de projetos no arquivo) + `best` (melhor placement > 0 + nome da edição) — derivado de `getMemberProjects`, sem tabela nova

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `/talento` carrega em qualquer estado (vazio ou cheio) sem erro e sem login
- **SC-002**: Membro que marca "open to" aparece no diretório no próximo carregamento (< 1s, sem rebuild)
- **SC-003**: 100% das linhas exibem prova verificável (projetos/placement vêm do arquivo real, não de campo livre)
- **SC-004**: Nenhum membro aparece sem ter optado — o diretório é consentido por construção

## Assumptions

- Os 4 valores da whitelist cobrem o vocabulário comercial de hackathon (emprego, sociedade, freela, mentoria); novos valores = nova whitelist, não free-text
- Em v1 o diretório é público pra qualquer visitante — paywall pra recrutador é o tier seguinte (o sinal `openTo` já existe pra isso)
- "Projetos entregues" = times vinculados no arquivo de edições (`team_members` → `teams`/`team_projects`); melhor colocação = menor `placement` > 0
- Ordenação por XP desc: quem mais construiu aparece primeiro (consistente com `/membros`)
