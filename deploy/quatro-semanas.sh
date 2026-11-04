#!/usr/bin/env bash
# 4 semanas depois (spec 046, onda 5, migration 052): materializa as semanas
# dos times inscritos, lembra na quinta o time que ainda não postou (uma vez
# por semana) e, no fim, concede o selo 'quatro-semanas' a quem fechou todas.
# Idempotente; roda uma vez por dia (linha em deploy/crontab.txt).
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" quatro-semanas 120
