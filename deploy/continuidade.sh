#!/usr/bin/env bash
# selo "continuou" (projeto vivo, migration 044): re-coleta o dossiê dos
# times com repositório de edição encerrada há 30 a 400 dias e grava a data do
# primeiro commit depois do fim da edição + 30 dias. Idempotente; roda uma vez
# por mês (linha em deploy/crontab.txt) e olha até 50 times por execução.
# Log com horário, por ambiente, e contador de falhas: deploy/cron-call.sh.
set -euo pipefail
exec bash "$(dirname "$0")/cron-call.sh" "${1:-prod}" continuidade 900
