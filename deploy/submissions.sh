#!/usr/bin/env bash
# lembretes da entrega (T-24h/T-3h/T-30min pra time em rascunho) e aviso de
# trava — spec 034. Idempotente; cron a cada 5 min. Os avisos saem pela
# fila de entregas (deliveries.sh).
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" submissions 60
