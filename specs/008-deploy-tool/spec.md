# Spec 008 — Deploy tool (repo → URL ao vivo)

> Status: aprovado. Decisões tomadas abaixo. Ideia original do César:
> participante aponta um repositório público e o HackaHub devolve uma
> URL funcionando — a demo vale sem ninguém saber fazer deploy.

## Problema

No fim do hackathon o projeto morre num repo do GitHub. Quem não sabe
fazer deploy não consegue mostrar a demo pra jurado, sponsor ou
recrutador.

## Decisões (fechadas)

| Questão | Decisão | Por quê |
|---|---|---|
| Runtime | **Docker na máquina host**, via CLI (`docker`) | usuário aprovou; daemon disponível |
| URL pública | **reverse proxy no próprio Next.js**: `/demo/[deployId]/...` → `http://127.0.0.1:<porta>` | funciona pelo tunnel/domínio atual SEM DNS wildcard nem Caddy; container publica só em 127.0.0.1 — não é acessível direto de fora |
| Isolamento | `--network bridge` + publish só em 127.0.0.1, `--read-only --tmpfs /tmp:64m`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--memory=256m --cpus=0.5 --pids-limit=64` | inbound chega só pelo proxy; outbound do container fica aberto — limitação assumida e mitigada por TTL+quota |
| Build | `git clone --depth=1` → `docker build` com Dockerfile detectado ou gerado | logs reais, imagem cacheável |
| Lifecycle | TTL 72h default; sweep expira; kill-switch admin | recurso finito, demo é efêmera |
| Quota | máx. 3 deploys running; 1 por projeto | evita abuso |
| Quem pode | membro do time (team_members) ou admin | o deploy pertence ao projeto |

## Stacks suportadas (v1)

1. **Dockerfile presente** no repo → `docker build` direto (container
   deve ouvir na porta 8080 ou declarar EXPOSE; injetamos `PORT=8080`).
2. **`package.json`** → Dockerfile gerado: `node:22-alpine`,
   `npm install && (npm run build || true)`, `PORT=8080 npm start`.
3. **Só `index.html`/estático** → `python:3.12-alpine` +
   `python -m http.server 8080`.
4. **`startCommand` opcional** na requisição → sobrescreve o CMD gerado
   (cobre Python/outros sem heurística frágil).

## User stories

### US1 — Membro publica a demo — P1

Membro do time (ou admin) faz `POST /api/projects/[teamId]/deploy` com
`{repoUrl?, startCommand?}`. Se o projeto já tem `repoUrl` no arquivo,
basta o POST vazio. Retorna 202 + `deployId`; status evolui
`queued → building → running` (ou `failed` com log). Quando running,
`GET /demo/[id]/` serve a app pelo domínio do HackaHub.

### US2 — Visitante abre a demo — P1

`/demo/[id]` e sub-paths são proxy transparente pro container.
Headers de resposta repassados (menos hop-by-hop). Demo expirada ou
parada → página tombstone honesta com link pro repo.

### US3 — Admin opera o inventário — P2

`GET /api/admin/deploys` lista todos; `POST /api/admin/deploys/[id]/stop`
derruba; `PATCH /api/admin/deploys/config` liga/desliga o serviço
(kill-switch). Deploys expirados são varridos a cada leitura.

## Requisitos funcionais

- FR-001: deploy vinculado a `teamId` de time com `team_projects` (FK
  lógica, sem projeto não deploya).
- FR-002: repos só `https://github.com/...` públicos (validação de URL +
  clone público; repo privado falha no clone → `failed`).
- FR-003: 1 deploy ativo por projeto — novo deploy pede stop do anterior.
- FR-004: status: `queued|building|running|failed|stopped|expired`.
- FR-005: log de build/clone guardado em `data/deploys/<id>.log`,
  últimas 200 linhas expostas ao dono/admin via API.
- FR-006: TTL default 72h (`deploys.expiresAt`); `sweepDeploys()` roda a
  cada GET/POST — não depende de cron.
- FR-007: kill-switch `settings.deploys_enabled`; quando off, POST → 503.
- FR-008: kill também faz `docker rm -f` + remove imagem (best-effort).
- FR-009: proxy bloqueia se deploy não está `running`.
- FR-010: portas de host sempre efêmeras em 127.0.0.1
  (`-p 127.0.0.1:0:8080`, porta real via `docker port`).

## Modelo de dados

```sql
deploys (
  id TEXT PRIMARY KEY,           -- nanoid curto
  teamId INTEGER NOT NULL,
  repoUrl TEXT NOT NULL,
  status TEXT NOT NULL,          -- queued|building|running|failed|stopped|expired
  port INTEGER,                  -- porta 127.0.0.1 do host
  containerName TEXT,
  expiresAt TEXT NOT NULL,
  error TEXT,                    -- última linha de erro p/ UI
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)
settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
```

## API

| Rota | Método | Auth | Resposta |
|---|---|---|---|
| `/api/projects/[teamId]/deploy` | POST | membro do time/admin | 202 `{deploy}` · 401/403/404/409/429 |
| `/api/projects/[teamId]/deploy` | GET | dono/admin | `{deploy, logTail}` |
| `/api/projects/[teamId]/deploy` | DELETE | dono/admin | para e marca `stopped` |
| `/api/admin/deploys` | GET | admin | todos |
| `/api/admin/deploys/[id]/stop` | POST | admin | para |
| `/api/admin/deploys/config` | PATCH | admin | `{enabled: bool}` |
| `/demo/[id]/[[...path]]` | GET/POST/… | público | proxy pro container |

## Edge cases

- Clone falha (repo privado/inexistente) → `failed`, log explica.
- Build falha → `failed` com tail do log.
- App não escuta na 8080 → health check falha → `failed` (ou `running`
  marcado só quando `/` responde).
- Deploy expira enquanto visitante usa → proxy passa a retornar
  tombstone.
- Container morre sozinho → status corrige pra `failed` no sweep
  (`docker inspect` best-effort).

## Limitações assumidas (honestas)

- Outbound do container é aberto (exfil/mine são possíveis) — mitigado
  por CPU/mem/pids/TTL. Sem Firecracker não há sandbox real.
- Apps SPA com paths absolutos (`/assets/...`) quebram sob `/demo/id/` —
  esperado; README no erro sugere relativo ou root path.
- Build roda no processo do Next (spawn detached) — se o server cair no
  meio do build, o deploy fica `building` até sweep marcar stale.
- Sem rede interna dedicada por enquanto: containers não se falam, mas
  o host inteiro é alcançável de dentro — aceito em máquina dedicada.

## Critérios de sucesso

- Um repo Next/Node público vira URL ao vivo em < 5 min.
- Repo estático idem.
- Falha de build retorna log legível ao dono.
- 3+1º deploy → 429 com mensagem clara.
- Desligar kill-switch para tudo e bloqueia novos.
