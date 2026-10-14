#!/usr/bin/env bash
# ciclo do RSVP anti-no-show (convite D-7, prazo D-3 libera vaga, lembretes
# D-1/H-2) — idempotente; cron a cada 15 min:
# (linha do cron em deploy/crontab.txt)
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" rsvp 120
