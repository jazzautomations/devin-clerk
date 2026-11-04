#!/usr/bin/env bash
# recalcula o nível (members.xp) pelos fatos verificados — idempotente;
# cron de hora em hora (linha em deploy/crontab.txt).
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" xp 300
