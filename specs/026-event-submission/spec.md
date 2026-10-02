# Feature Specification: Indicação de Hackathon pela Comunidade

**Feature**: `026-event-submission`
**Created**: 2026-11-22
**Status**: Draft
**Input**: O radar hoje tem duas origens: scraper das fontes oficiais (`source` = devpost/taikai/…) e curadoria manual do admin (`source` = 'curadoria' ou nulo). Modelo Café Bugado: a comunidade enxerga hackathon que nenhum dos dois canais pega — meetup de bairro, edição universitária, evento gringo fora do radar. Hoje não existe porta pra dizer "vi esse evento, cadastra aí". Aqui qualquer visitante indica um hackathon pelo próprio radar; a indicação cai numa fila de curadoria no `/admin` e só entra no radar depois do ok do organizador — `source` = 'comunidade' marca a terceira origem.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitante indica um hackathon no radar (Priority: P1)

Quem navega `/radar` — logado ou não — chega ao fim da página e encontra o bloco "// indica um hackathon": nome do evento, link oficial, data e formato opcionais, e um campo de nota. Enviar não publica nada: a indicação vira uma linha `pending` na fila de curadoria e a UI diz isso honestamente ("vai pra curadoria").

**Why this priority**: É o terceiro canal do radar inteiro. Sem a porta de indicação, o radar fica refém do que o scraper acha e do tempo do admin — a comunidade que vê tudo não alimenta nada.

**Independent Test**: Deslogado, `POST /api/submissions` com `{name, url}` válidos → 201 e a linha existe em `event_submissions` com `status='pending'`; `/radar` renderiza o bloco de indicação no fim.

**Acceptance Scenarios**:

1. **Given** visitante (logado ou não), **When** submete `name` + `url` http(s) válidos, **Then** recebe 201 com a submissão `pending` — nada entra no radar ainda
2. **Given** o mesmo visitante, **When** submete sem `name`, sem `url`, com `url` não-http(s) (`javascript:`, `ftp:`) ou `format` fora da whitelist, **Then** recebe 400 sem gravar
3. **Given** bot que preenche o honeypot `company`, **When** submete, **Then** recebe 201 silencioso e nada grava (resposta indistinguível de sucesso)
4. **Given** mesma `url` reenviada em <24h, **When** submete, **Then** 200 idempotente sem duplicar a indicação

---

### User Story 2 - Organizador cura a fila no admin (Priority: P1)

O admin abre `/admin` e vê a seção "// indicações" com a fila pendente: nome, link, data/local/formato/nota de quem indicou. Cada item tem dois botões — aprovar cria a edição em `hackathons` (ativa, `source='comunidade'`, entra no radar na hora) e marca a indicação `approved`; recusar só marca `rejected` e tira da fila.

**Why this priority**: Curadoria é o que separa "indicação" de "spam no radar" — sem ela, a porta pública vira graffiti. Mesma prioridade porque a US1 sem desfecho é lixo acumulado.

**Independent Test**: Admin faz `POST /api/admin/submissions/[id]` com `{action:"approve"}` → a edição existe em `hackathons` (`source='comunidade'`, `active=1`) e aparece em `getUpcomingHackathons`; a indicação sai da lista `pending`.

**Acceptance Scenarios**:

1. **Given** indicação pendente, **When** admin aprova, **Then** nasce hackathon com `id` slugificado de nome+ano, `organizer='comunidade'` (ou o `org: X` da nota), `source='comunidade'`, `active=1`, `registrationUrl` = url indicada, e a submissão vira `approved` com `reviewedAt`
2. **Given** indicação pendente, **When** admin recusa, **Then** a submissão vira `rejected` com `reviewedAt` e nenhum hackathon nasce
3. **Given** id inexistente, **When** admin posta, **Then** 404; `action` fora de `approve`/`reject` → 400
4. **Given** visitante deslogado, **When** `GET /api/submissions` ou posta na rota admin, **Then** 401; membro não-admin → 403

---

### User Story 3 - Slug único e idempotência da curadoria (Priority: P2)

Duas indicações de nomes parecidos, ou o mesmo evento indicado por duas pessoas, não podem colidir na tabela `hackathons`: o id é derivado de nome+ano e, em conflito, ganha sufixo numérico. Revisar duas vezes a mesma indicação é no-op — não duplica evento nem reabre status.

**Why this priority**: Sem slug determinístico + sufixo, o segundo "Hackathons IA 2026" indicado explode no INSERT ou sobrescreve o primeiro — corrupção silenciosa do radar.

**Independent Test**: Aprovar duas indicações com mesmo nome/ano → dois hackathons com ids distintos (`-2` no segundo); re-aprovar a mesma indicação → 200 sem hackathon novo.

**Acceptance Scenarios**:

1. **Given** indicação "Hackathon IA" com `startsAt` em 2026, **When** aprovada, **Then** o id é `hackathon-ia-2026`; a segunda igual vira `hackathon-ia-2026-2`
2. **Given** indicação já `approved`, **When** admin posta `approve` de novo, **Then** 200 idempotente sem INSERT extra em `hackathons`
3. **Given** indicação sem `startsAt`, **When** aprovada, **Then** nasce com data sentinela de fim de agenda (o admin corrige depois pela edição normal) e o slug não ganha ano

---

### Edge Cases

- Honeypot `company` (o form nunca pergunta empresa — campo escondido pra bot): preenchido → 201 sem gravar
- `format` omitido → default `online`; fora de `online|presencial|hibrido` → 400
- `startsAt`/`location`/`note` são opcionais — `startsAt` malformado (não parseia como data) → 400
- Nota com `org: Nome do Organizador` → vira `organizer` do hackathon; sem padrão → `organizer='comunidade'`
- Dedupe é por `url` (case-insensitive) em qualquer status dentro de 24h — evento já recusado re-indicado na janela ainda é no-op; depois da janela, entra de novo pra curadoria
- GET `/api/submissions` lista só `pending`, mais antiga primeiro (fila FIFO de curadoria)
- Evento aprovado com `source='comunidade'` não é `partner` (não vira "sessão hack inova") e não é seed — o sweep do `lib/db.ts` não o toca, mas o scraper pode desativá-lo quando a data passa (igual aos raspados)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Entidade `event_submissions` com schema idempotente no próprio `lib/submissions.ts` (pattern `lib/leads.ts`/`lib/deploys.ts`, sem tocar `lib/db.ts`): `id` INTEGER PK, `name` NOT NULL, `url` NOT NULL, `startsAt`/`location`/`note` nullable, `format` NOT NULL com CHECK na whitelist `online|presencial|hibrido`, `status` NOT NULL CHECK `pending|approved|rejected` default `pending`, `createdAt` NOT NULL, `reviewedAt` nullable
- **FR-002**: `createSubmission` DEVE validar `name` não-vazio, `url` http(s) parseável, `format` na whitelist (default `online`), `startsAt` parseável quando presente; DEVE deduplicar por `lower(url)` dentro de janela de 24h retornando `{submission, created:false}`
- **FR-003**: `POST /api/submissions` é PÚBLICO: honeypot `company` preenchido → 201 `{ok:true}` sem gravar; válido → 201 `{submission}`; dedupe → 200 `{submission, deduped:true}`; inválido → 400
- **FR-004**: `GET /api/submissions` é admin-only: 401 deslogado, 403 não-admin, 200 `{submissions}` com a fila `pending` (mais antiga primeiro)
- **FR-005**: `POST /api/admin/submissions/[id]` — auth (401), admin (403), id inexistente → 404, `action` fora de `approve|reject` → 400; `approve` insere em `hackathons` (`id` slug nome+ano com sufixo em conflito, `organizer` da nota ou 'comunidade', `source='comunidade'`, `active=1`) e marca `approved`; `reject` só marca `rejected`; ambos gravam `reviewedAt` e são no-op em submissão já revisada
- **FR-006**: `/radar` mostra no fim um `<details>` "// indica um hackathon" com `SubmitEventForm` (client) — página continua server component, sem rota nova; sucesso mostra mensagem honesta "vai pra curadoria"
- **FR-007**: `/admin` ganha seção "// indicações" apensa no fim (diff mínimo) listando pendentes com `SubmissionActions` (client, botões aprovar/recusar no pattern `ChallengeToggle`)
- **FR-008**: Nada da indicação aparece no radar antes do approve — `event_submissions` nunca alimenta listagem pública

### Key Entities

- **EventSubmission**: indicação da comunidade — `name`, `url`, `startsAt?`, `location?`, `format`, `note?`, `status` (`pending` → `approved`/`rejected`), `createdAt`, `reviewedAt`
- Terceira origem do radar: `hackathons.source` = 'comunidade' (junto de scraper `source`=devpost/taikai/… e curadoria admin `source` NULL/'curadoria')

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Visitante indica evento em <1 min saindo do próprio `/radar`, sem login e sem falar com o organizador
- **SC-002**: 0 indicações publicadas sem curadoria; 0 duplicadas por retry em 24h; 0 gravadas por bot via honeypot
- **SC-003**: 100% dos aprovados nascem `hackathons` com id único determinístico (`source='comunidade'`) e aparecem no radar na hora
- **SC-004**: Rotas de leitura/curadoria respondem 401/403 garantido por teste — a fila nunca é pública

## Assumptions

- Indicar não exige login (mesma porta pública do lead comercial, spec 022); abuso é freado por honeypot + dedupe + curadoria — nunca por captcha
- `organizer` derivado da nota é convenção leve (`org: nome`) — o admin sempre pode editar depois pela edição normal
- Indicação sem `startsAt` nasce com data sentinela distante pra satisfazer o NOT NULL de `hackathons` e ficar no fim do radar; o admin corrige na seção de edição
- Revisão é terminal: reabrir uma `rejected`/`approved` não é oferecido (admin resolve no banco se precisar)
