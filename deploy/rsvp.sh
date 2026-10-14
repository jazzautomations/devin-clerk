#!/usr/bin/env bash
# ciclo do RSVP anti-no-show (convite D-7, prazo D-3 libera vaga, lembretes
# D-1/H-2) — idempotente; cron a cada 15 min:
# */15 * * * * /home/ubuntu/hackahub/deploy/rsvp.sh prod
set -euo pipefail
ENV_NAME=${1:-prod}
PORT=$( [ "$ENV_NAME" = prod ] && echo 3411 || echo 3410 )
SECRET=$(grep '^HACKAHUB_CRON_SECRET=' /home/ubuntu/hackahub-secrets/$ENV_NAME.env | cut -d= -f2-)
curl -fsS -m 120 -X POST -H "Authorization: Bearer $SECRET" "http://127.0.0.1:$PORT/api/cron/rsvp" >/dev/null
