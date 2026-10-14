#!/usr/bin/env bash
# Chama uma rota /api/cron/<rota> do ambiente e registra UMA linha por
# chamada em ~/hackahub/logs/<rota>-<env>.log:
#   2026-10-14T04:36:01Z prod deliveries http=500 1.204s corpo: {"error":...}
# Também mantém logs/.fail-<rota>-<env> com o número de falhas seguidas
# (zera no sucesso), que o /api/health?deep=1 expõe pro monitor externo.
#   bash cron-call.sh <stage|prod> <rota> [timeout-segundos=60]
set -uo pipefail
ENV_NAME=${1:?uso: cron-call.sh <stage|prod> <rota> [timeout]}
ROUTE=${2:?rota}
TIMEOUT=${3:-60}
case "$ENV_NAME" in
  prod) PORT=3411 ;;
  stage) PORT=3410 ;;
  *) echo "ambiente inválido: $ENV_NAME" >&2; exit 2 ;;
esac
case "$ROUTE" in
  *[!a-z0-9-]*|"") echo "rota inválida: $ROUTE" >&2; exit 2 ;;
esac
LOGS=${HACKAHUB_LOG_DIR:-/home/ubuntu/hackahub/logs}
SECRETS=${HACKAHUB_SECRETS_DIR:-/home/ubuntu/hackahub-secrets}
mkdir -p "$LOGS"
LOG="$LOGS/$ROUTE-$ENV_NAME.log"
FAIL="$LOGS/.fail-$ROUTE-$ENV_NAME"
SECRET=$(grep '^HACKAHUB_CRON_SECRET=' "$SECRETS/$ENV_NAME.env" | cut -d= -f2-)
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

OUT=$(curl -sS -m "$TIMEOUT" -o "$BODY" -w '%{http_code} %{time_total}' \
  -X POST -H "Authorization: Bearer $SECRET" \
  "http://127.0.0.1:$PORT/api/cron/$ROUTE" 2>&1)
RC=$?
CODE=${OUT%% *}
TIME=${OUT##* }
NOW=$(date -u +%FT%TZ)

if [ "$RC" -eq 0 ] && [ "${CODE:0:1}" = 2 ]; then
  echo "$NOW $ENV_NAME $ROUTE http=$CODE ${TIME}s" >> "$LOG"
  echo 0 > "$FAIL"
  exit 0
fi

N=$(( $(cat "$FAIL" 2>/dev/null || echo 0) + 1 ))
echo "$N" > "$FAIL"
if [ "$RC" -ne 0 ]; then
  DETAIL="curl=$RC $(printf '%s' "$OUT" | tr '\n' ' ' | head -c 300)"
else
  DETAIL="http=$CODE ${TIME}s corpo: $(head -c 300 "$BODY" | tr '\n' ' ')"
fi
echo "$NOW $ENV_NAME $ROUTE FALHA#$N $DETAIL" >> "$LOG"
exit 1
