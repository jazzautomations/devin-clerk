#!/usr/bin/env bash
# Deploy do HackaHub na VPS asyn — release imutável + symlink + rollback.
#   bash deploy.sh <stage|prod> <release.tar.gz>
# O tarball é um `git archive` do commit. Cada ambiente tem porta, banco,
# serviço systemd e bloco Caddy próprios; nada aqui toca nos outros sites
# da máquina. Health falhou → volta pro release anterior sozinho.
set -euo pipefail

ENV_NAME="${1:?uso: deploy.sh <stage|prod> <tarball>}"
TARBALL="${2:?tarball}"
case "$ENV_NAME" in
  stage) PORT=3410; HOSTS="hackahub-stage.64-181-217-112.sslip.io" ;;
  prod)  PORT=3411; HOSTS="hackahub.64-181-217-112.sslip.io, hackahub.jazzautomations.com.br" ;;
  *) echo "ambiente inválido: $ENV_NAME" >&2; exit 1 ;;
esac

BASE=/home/ubuntu/hackahub/$ENV_NAME
SECRETS=/home/ubuntu/hackahub-secrets
ENV_FILE=$SECRETS/$ENV_NAME.env
SERVICE=hackahub-$ENV_NAME
REL=$BASE/releases/$(date -u +%Y%m%d%H%M%S)
[ -f "$ENV_FILE" ] || { echo "falta $ENV_FILE" >&2; exit 1; }

mkdir -p "$REL"
tar -xzf "$TARBALL" -C "$REL"

echo "== build ($REL)"
cd "$REL"
set -a; . "$ENV_FILE"; set +a
nice -n 10 npm ci --no-audit --no-fund --loglevel=error
nice -n 10 npx next build > "$REL/build.log" 2>&1 || { tail -40 "$REL/build.log"; exit 1; }

echo "== systemd"
UNIT=/etc/systemd/system/$SERVICE.service
sudo tee "$UNIT.new" >/dev/null <<UNITEOF
[Unit]
Description=HackaHub ($ENV_NAME)
After=network-online.target docker.service

[Service]
User=ubuntu
WorkingDirectory=$BASE/current
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1
Restart=always
RestartSec=3
Nice=5
MemoryMax=1536M
CPUQuota=200%

[Install]
WantedBy=multi-user.target
UNITEOF
if ! sudo cmp -s "$UNIT.new" "$UNIT"; then sudo mv "$UNIT.new" "$UNIT"; sudo systemctl daemon-reload; else sudo rm "$UNIT.new"; fi
sudo systemctl enable "$SERVICE" >/dev/null 2>&1

PREV=$(readlink -f "$BASE/current" 2>/dev/null || true)
ln -sfn "$REL" "$BASE/current"
sudo systemctl restart "$SERVICE"

echo "== health"
ok=0
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "health falhou — rollback" >&2
  sudo journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$BASE/current"; sudo systemctl restart "$SERVICE"
  fi
  exit 1
fi

echo "== caddy"
CADDYFILE=/etc/caddy/Caddyfile
MARK="# hackahub-$ENV_NAME"
if ! sudo grep -q "^$MARK\$" "$CADDYFILE"; then
  BAK="$CADDYFILE.bak-hackahub-$(date -u +%s)"
  sudo cp "$CADDYFILE" "$BAK"
  sudo tee -a "$CADDYFILE" >/dev/null <<CADDYEOF

$MARK
$HOSTS {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDYEOF
  if sudo caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    sudo systemctl reload caddy
  else
    echo "Caddyfile inválido — restaurando backup" >&2
    sudo cp "$BAK" "$CADDYFILE"; exit 1
  fi
fi

echo "== limpeza (mantém 3 releases)"
ls -1dt "$BASE"/releases/* | tail -n +4 | xargs -r rm -rf

echo "ok: $ENV_NAME → $(readlink -f "$BASE/current") em :$PORT ($HOSTS)"
