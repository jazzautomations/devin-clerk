#!/usr/bin/env bash
# Testa o release standalone antes do deploy: o e2e sobe `next start` com o
# node_modules inteiro, e o servidor de verdade sobe `node server.js` só com
# o que o Next rastreou. Monta o release igual ao deploy.sh, sobe na porta
# dada e roda o smoke.sh contra ele.
#   (depois de `next build`, com o env do app já exportado)
#   bash deploy/standalone-smoke.sh <porta> [banco]
# O sandbox de disco da unit (ProtectSystem=strict, ProtectHome=read-only)
# não dá pra simular sem root na VPS: o systemd --user ignora essas opções
# sem user namespace, e o Ubuntu bloqueia namespace sem privilégio. Quem pega
# escrita barrada é o deploy.sh, que procura EROFS/EACCES no journal do stage.
set -euo pipefail
PORT="${1:?porta}"
DBN="${2:-}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# dentro do projeto, como na VPS (release no home, não no /tmp)
REL="$ROOT/.next-smoke-release"
LOG="$ROOT/.next-smoke-release.log"
rm -rf "$REL"
PID=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  rm -rf "$REL"
}
trap cleanup EXIT

bash "$ROOT/deploy/assemble-release.sh" "$ROOT" "$REL"
echo "release standalone: $(du -sh "$REL" | cut -f1) em $REL"

(cd "$REL" && NODE_ENV=production PORT="$PORT" exec node server.js) >"$LOG" 2>&1 &
PID=$!

for _ in $(seq 1 60); do
  curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true' && break
  sleep 1
done

rc=0
bash "$ROOT/deploy/smoke.sh" "http://127.0.0.1:$PORT" "$DBN" || rc=1
if grep -E 'EROFS|ENOENT|EACCES' "$LOG"; then echo "erro de disco no log do servidor" >&2; rc=1; fi
[ "$rc" = 0 ] || { echo "--- log do servidor"; tail -40 "$LOG"; }
rm -f "$LOG"
exit "$rc"
