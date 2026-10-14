#!/usr/bin/env bash
# reprocessa a fila de entregas de avisos (e-mail/WhatsApp) — cron a cada 2 min
set -euo pipefail
ENV_NAME=${1:-prod}
PORT=$( [ "$ENV_NAME" = prod ] && echo 3411 || echo 3410 )
SECRET=$(grep '^HACKAHUB_CRON_SECRET=' /home/ubuntu/hackahub-secrets/$ENV_NAME.env | cut -d= -f2-)
curl -fsS -m 60 -X POST -H "Authorization: Bearer $SECRET" "http://127.0.0.1:$PORT/api/cron/deliveries" >/dev/null
