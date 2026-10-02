# Feature Specification: Rate Limiting

**Feature**: `031-rate-limit`
**Created**: 2026-12-02
**Status**: Draft
**Input**: As portas públicas de escrita têm honeypot e dedupe, mas nenhum freio de volume: `POST /api/leads`, `/api/submissions`, `/api/posts`, comentários, votos, inscrições, submissão de time e anúncio no board são todos abusáveis por spam/flood. O deploy é single-process (dev/VPS), então um limiter em memória é honesto por ora — por instância, zera no restart; distribuído pede Redis depois.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bot não flooda as portas públicas (Priority: P1)

Bot/script que dispara `POST /api/leads` ou `/api/submissions` em loop recebe as primeiras respostas normais e, a partir do limite da janela, `429` com `Retry-After` — sem gravar nada. O honeypot continua valendo dentro do limite; acima dele nem o sucesso falso sai de graça.

**Why this priority**: São as únicas portas de escrita SEM login — o alvo mais óbvio de spam. Honeypot pega bot burro, dedupe pega repetição, mas nada freia volume: um script com e-mails variados enche a fila de curadoria.

**Independent Test**: 6 requisições do mesmo IP para `POST /api/leads` em sequência → as 5 primeiras passam pelo fluxo normal (201/200/400), a 6ª volta 429 com header `Retry-After` e nada novo é gravado.

**Acceptance Scenarios**:

1. **Given** IP que ainda não chamou `/api/leads` na última hora, **When** faz até 5 POSTs, **Then** todos seguem o fluxo normal (201/200/400 conforme o payload)
2. **Given** IP que já fez 5 POSTs na janela, **When** faz o 6º, **Then** recebe 429 `{error:"muitas requisições — tenta de novo em Ns"}` + header `Retry-After: N` e o lead NÃO é gravado — mesmo com honeypot vazio e payload válido
3. **Given** IP A limitado, **When** IP B chama a mesma rota, **Then** B segue normal — o limite é por chave, não global
4. **Given** requisição sem `x-forwarded-for`/`x-real-ip`, **When** chama a rota, **Then** conta no bucket `anon` (fallback honesto em dev)

---

### User Story 2 - Membro não flooda as escritas autenticadas (Priority: P1)

Membro logado que dispara `POST /api/posts`, comentários, likes, votos, inscrição, submissão de time ou anúncio no board em loop é freado por um teto por hora **por membro** — o limite segue a conta, não o IP (membro atrás de NAT/rede compartilhada não paga pelo vizinho).

**Why this priority**: Autenticado ≠ confiável — conta comprometida ou script com sessão roubada esvaziaria XP/feed/notificações. E chavear por memberId não pune quem divide IP (coworking, campus).

**Independent Test**: Membro faz 11 POSTs em `/api/hackathons/[id]/register` na mesma hora → os 10 primeiros seguem o fluxo (200), o 11º volta 429; outro membro continua normal.

**Acceptance Scenarios**:

1. **Given** membro dentro do limite, **When** posta/comenta/vota, **Then** recebe a resposta normal da rota
2. **Given** membro que estourou o limite de comentários, **When** comenta de novo, **Then** recebe 429 + `Retry-After`; e consegue POSTAR (bucket separado) — limites são por rota, não por conta
3. **Given** chamada deslogada ou sem member, **When** bate numa rota autenticada, **Then** recebe o 401 de sempre e NÃO consome quota de ninguém — o limiter só roda depois que o membro existe
4. **Given** membro limitado que aguarda a janela deslizar, **When** o hit mais antigo expira, **Then** volta a passar sem esperar "a hora fechada" (janela deslizante, não fixa)

---

### User Story 3 - Resposta 429 consistente e testável (Priority: P2)

Toda rota limitada responde o mesmo formato: `429` JSON `{error:"muitas requisições — tenta de novo em Ns"}` com header `Retry-After` em segundos. O helper único (`limitOrNull`) garante que nenhuma rota inventa formato próprio.

**Why this priority**: Cliente que entende `Retry-After` pode fazer backoff honesto; formato único facilita teste e documentação.

**Independent Test**: Inspecionar as 9 rotas: todas retornam o mesmo shape de erro e o header numérico.

**Acceptance Scenarios**:

1. **Given** qualquer rota limitada estourada, **When** responde, **Then** body é `{error: "muitas requisições — tenta de novo em Ns"}` e `Retry-After` casa com o N da mensagem
2. **Given** teste de unidade, **When** injeta `now` nas chamadas, **Then** o comportamento da janela é determinístico (sem `sleep`)

---

### Edge Cases

- IP compartilhado (NAT/coworking) em rota pública: todos do mesmo IP dividem o bucket — limite baixo (5/h) minimiza dano a legítimos; rotas autenticadas não sofrem (chave é memberId)
- `x-forwarded-for` spoofável: em produção atrás de proxy que sobrescreve o header é ok; direto na internet o atacante rotaciona IP — mitigação real vem com infra (Cloudflare/proxy), não desta lib
- Restart do processo: o Map zera — quota renovada. Documentado como limitação aceita (single-process)
- Requisições que falham auth/404/403 ANTES do limiter não consomem quota — anon não queima limite de membro
- Body inválido em rota pública conta no limite — flood de lixo também é flood
- Mesma chave com buckets diferentes (`leads:ip` vs `submissions:ip`): independentes — estourar uma porta não fecha a outra

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `rateLimit(key, {limit, windowMs}, now?)` implementa janela deslizante em memória: guarda timestamps por chave, descarta os fora da janela, permite enquanto `count < limit` e retorna `{ok, retryAfterSec}` — `retryAfterSec` = segundos até o hit mais antigo expirar (mínimo 1), `0` quando ok
- **FR-002**: Estado em `Map` módulo-global com limpeza lazy (podar na leitura) + varredura a cada ~60s de atividade que remove chaves vencidas — sem timers/intervalos no processo
- **FR-003**: `clientIp(req)` = primeiro hop de `x-forwarded-for` → `x-real-ip` → `'anon'`
- **FR-004**: `limitOrNull(req, bucket, key?, opts?) → Response | null` monta a chave `${bucket}:${key ?? ip}`, aplica o limite e, quando estoura, retorna `429` JSON `{error:"muitas requisições — tenta de novo em Ns"}` + `Retry-After: N`
- **FR-005**: Buckets e limites (janela de 1h): `leads` 5/ip, `submissions` 5/ip, `posts` 20/membro, `comments` 30/membro, `votes` 60/membro, `likes` 60/membro, `register` 10/membro, `team` 10/membro, `team-board` 10/membro — tabela única `RATE_LIMITS` na lib
- **FR-006**: Rotas autenticadas chamam o limiter depois que o member existe, passando `member.id` como key (fallback pro IP quando não há member); rotas públicas limitam no topo do handler por IP. Checks anteriores (401/403/404) não consomem quota
- **FR-007**: `opts` configurável por chamada pra testes com janelas mínimas; `resetRateLimits()` exportado só pra testes zerarem o estado entre casos

### Key Entities

- **Bucket**: namespace do limite (string, ex. `"leads"`) — prefixa a chave pra isolar rotas
- **Chave**: `${bucket}:${memberId|ip}` — quem é contado
- **Entrada**: lista de timestamps (ms) dentro da janela; vive num `Map` por processo — sem persistência, sem tabela nova

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 6º `POST /api/leads` do mesmo IP na mesma hora → 429 com `Retry-After` (provado em API test e e2e)
- **SC-002**: Membro que estoura um bucket recebe 429 JSON; outro membro e outros buckets do mesmo membro seguem livres
- **SC-003**: Tráfego normal inalterado — suíte de API/e2e existente continua verde (nenhum fluxo legítimo toca os tetos)
- **SC-004**: Limitação "por instância, zera no restart, distribuído pede Redis" documentada na lib e no plan — honestidade de escopo

## Assumptions

- Deploy single-process (dev/VPS) — estado em memória é suficiente; não finge ser distribuído
- Atrás de proxy (quick tunnel / futura borda) o `x-forwarded-for` chega correto; em dev sem header cai no bucket `anon` compartilhado — aceitável em teste
- Janela única de 1h pra todos os buckets — granularidade diferente por rota seria ruído sem necessidade
- `limit`/`windowMs` são parâmetros da chamada (a tabela `RATE_LIMITS` é só default), então testes não precisam esperar tempo real nem depender de retryAfter longo
