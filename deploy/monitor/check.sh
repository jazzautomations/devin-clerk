#!/usr/bin/env bash
# Monitor externo do HackaHub. Roda FORA da VPS (imac-server), pelo cron:
#   */2 * * * * bash ~/hackahub-monitor/check.sh >> ~/hackahub-monitor/check.log 2>&1
# Lê https://<site>/api/health?deep=1 e manda zap pelo Evolution quando:
#   - o site não responde ou o banco está fora (2 falhas seguidas)
#   - backup com mais de 26 h, ou restore drill de prod com mais de 8 dias (ou nenhum)
#   - fila de avisos/ingressos parada há mais de 15 min
#   - disco em 85% ou mais
#   - algum cron com 3 falhas seguidas
# Avisa uma vez quando o problema começa e uma vez quando volta ao normal.
# Config em ~/hackahub-monitor/env (veja README.md).
set -uo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=/dev/null
[ -f "$DIR/env" ] && . "$DIR/env"
URL=${HH_HEALTH_URL:-https://hackahub.jazzautomations.com.br/api/health?deep=1}
STATE=$DIR/state
mkdir -p "$STATE"

send() {
  [ -n "${EVOLUTION_URL:-}" ] || { echo "sem EVOLUTION_URL: $1" >&2; return; }
  curl -fsS -m 15 -X POST "$EVOLUTION_URL/message/sendText/$EVOLUTION_INSTANCE" \
    -H "apikey: $EVOLUTION_API_KEY" -H 'content-type: application/json' \
    -d "$(jq -nc --arg n "$ALERT_NUMBER" --arg t "$1" '{number:$n, text:$t}')" >/dev/null \
    || echo "falha ao mandar zap: $1" >&2
}

# raise <chave> <problema?0|1> <texto>: muda de estado → avisa
raise() {
  local key=$1 bad=$2 text=$3 f=$STATE/$1
  if [ "$bad" = 1 ]; then
    [ -f "$f" ] || { echo "$(date -u +%FT%TZ)" > "$f"; send "HackaHub: $text"; }
  elif [ -f "$f" ]; then
    rm -f "$f"; send "HackaHub voltou ao normal: $key"
  fi
}

NOW=$(date -u +%FT%TZ)
BODY=$(curl -sS -m 15 "$URL" 2>/dev/null)
OK=$(printf '%s' "$BODY" | jq -r '.ok // false' 2>/dev/null || echo false)

if [ "$OK" != true ]; then
  N=$(( $(cat "$STATE/.down" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$STATE/.down"
  echo "$NOW fora (falha $N)"
  [ "$N" -ge 2 ] && raise site 1 "site ou banco fora do ar ($URL, $N verificações seguidas)"
  exit 0
fi
echo 0 > "$STATE/.down"
raise site 0 ""

j() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null; }
gt() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a != "null" && a != "" && a+0 > b+0)}'; }

B=$(j '.backupAgeH'); D=$(j '.drillAgeH'); Q1=$(j '.oldestQueuedDeliveryMin'); Q2=$(j '.oldestQueuedTicketMin'); DK=$(j '.diskPct')
if [ "$B" = null ] || gt "$B" 26; then raise backup 1 "último backup há ${B} h (limite 26 h)"; else raise backup 0 ""; fi
# drillAgeH é só o drill de prod; sem carimbo também alerta (rode um drill
# de prod à mão logo depois de instalar, pra não alertar até o domingo)
if [ "$D" = null ]; then raise drill 1 "nenhum restore drill de prod registrado"
elif gt "$D" 192; then raise drill 1 "último restore drill de prod há ${D} h (limite 8 dias)"; else raise drill 0 ""; fi
if gt "$Q1" 15 || gt "$Q2" 15; then raise fila 1 "fila parada: avisos ${Q1} min, ingressos ${Q2} min"; else raise fila 0 ""; fi
if gt "$DK" 84; then raise disco 1 "disco da VPS em ${DK}%"; else raise disco 0 ""; fi
CF=$(j '[.cronFails | to_entries[] | select(.value >= 3) | "\(.key)=\(.value)"] | join(" ")')
if [ -n "$CF" ]; then raise cron 1 "cron falhando seguido: $CF"; else raise cron 0 ""; fi
echo "$NOW ok versão=$(j '.version') backup=${B}h disco=${DK}%"
