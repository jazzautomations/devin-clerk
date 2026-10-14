# Monitor externo do HackaHub

Roda fora da VPS (no imac-server), porque um monitor na própria VPS cai junto
com ela. A cada 2 min lê `/api/health?deep=1` e manda zap pelo Evolution que
já roda no imac-server.

## Instalar (no imac-server)

```bash
mkdir -p ~/hackahub-monitor
cp deploy/monitor/check.sh ~/hackahub-monitor/
cat > ~/hackahub-monitor/env <<'ENV'
HH_HEALTH_URL=https://hackahub.jazzautomations.com.br/api/health?deep=1
EVOLUTION_URL=http://127.0.0.1:8080
EVOLUTION_INSTANCE=<instância>
EVOLUTION_API_KEY=<chave>
ALERT_NUMBER=55<ddd><número>
ENV
chmod 600 ~/hackahub-monitor/env
# precisa de curl e jq
(crontab -l; echo '*/2 * * * * bash ~/hackahub-monitor/check.sh >> ~/hackahub-monitor/check.log 2>&1') | crontab -
```

Teste: `HH_HEALTH_URL=https://hackahub.jazzautomations.com.br/api/health?deep=1 bash ~/hackahub-monitor/check.sh`
imprime uma linha `ok versão=…`. Pra ver o alerta chegar, rode uma vez com
`HH_HEALTH_URL=https://exemplo.invalid/` duas vezes seguidas e depois volte.

## O que dispara aviso

| Chave | Quando |
|---|---|
| `site` | 2 verificações seguidas sem `"ok":true` (site fora ou banco fora) |
| `backup` | `backupAgeH` ausente ou acima de 26 h |
| `drill` | `drillAgeH` (só o drill de prod) acima de 8 dias, ou nenhum drill de prod registrado |
| `fila` | aviso ou ingresso na fila há mais de 15 min |
| `disco` | `diskPct` em 85% ou mais |
| `cron` | algum `/api/cron/*` com 3 falhas seguidas (`cronFails`) |

Cada chave avisa uma vez quando começa e uma vez quando volta. O estado fica
em `~/hackahub-monitor/state/`.

## Dead-man dos crons (opcional)

Com conta no Healthchecks.io, grave a URL do check em
`~/hackahub-secrets/hc-backup.url` na VPS: o `backup.sh` pinga no sucesso e
`/fail` na falha.
