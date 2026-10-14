#!/usr/bin/env bash
# lembretes da entrega (T-24h/T-3h/T-30min pra time em rascunho) e aviso de
# trava — spec 034. Idempotente; cron a cada 5 min. Os avisos saem pela
# fila de entregas (deliveries.sh).
set -euo pipefail
ENV_NAME=${1:-prod}
PORT=$( [ "$ENV_NAME" = prod ] && echo 3411 || echo 3410 )
SECRET=$(grep '^HACKAHUB_CRON_SECRET=' /home/ubuntu/hackahub-secrets/$ENV_NAME.env | cut -d= -f2-)
curl -fsS -m 60 -X POST -H "Authorization: Bearer $SECRET" "http://127.0.0.1:$PORT/api/cron/submissions" >/dev/null
