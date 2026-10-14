#!/usr/bin/env bash
# reprocessa a fila de entregas de avisos (e-mail/WhatsApp) — cron a cada 2 min
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" deliveries 60
