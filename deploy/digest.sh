#!/usr/bin/env bash
# resumo semanal por e-mail (migration 040): segunda 12:00 UTC, prod; stage
# às 12:30 (linhas em deploy/crontab.txt). Idempotente por (pessoa, semana):
# rodar de novo na mesma semana só tenta quem falhou. Lotes de 100 dentro da
# mesma chamada, por isso o timeout maior.
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" digest 600
