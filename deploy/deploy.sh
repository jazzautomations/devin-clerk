#!/usr/bin/env bash
# Deploy do HackaHub na VPS asyn — release imutável + symlink + rollback.
#   bash deploy.sh <stage|prod> <release.tar.gz> [versão]
# O tarball é um `git archive` do commit (a versão sai do próprio tarball,
# via `git get-tar-commit-id`, ou do 3º argumento). Cada ambiente tem porta,
# banco, serviço systemd e bloco Caddy próprios; nada aqui toca nos outros
# sites da máquina. Health falhou → volta pro release anterior sozinho.
#
# O build roda numa pasta temporária e o release recebe só a saída
# standalone do Next (server.js + node_modules que o servidor usa, ~150 MB
# em vez de 1,1 GB) mais o que o app lê do disco em runtime.
set -euo pipefail

ENV_NAME="${1:?uso: deploy.sh <stage|prod> <tarball> [versão]}"
TARBALL="${2:?tarball}"
case "$ENV_NAME" in
  stage) PORT=3410; HOSTS="hackahub-stage.64-181-217-112.sslip.io" ;;
  prod)  PORT=3411; HOSTS="hackahub.64-181-217-112.sslip.io, hackahub.jazzautomations.com.br" ;;
  *) echo "ambiente inválido: $ENV_NAME" >&2; exit 1 ;;
esac

BASE=/home/ubuntu/hackahub/$ENV_NAME
OPS=/home/ubuntu/hackahub/ops
SECRETS=/home/ubuntu/hackahub-secrets
ENV_FILE=$SECRETS/$ENV_NAME.env
SERVICE=hackahub-$ENV_NAME
STAMP=$(date -u +%Y%m%d%H%M%S)
REL=$BASE/releases/$STAMP
BUILD=/home/ubuntu/hackahub/tmp/build-$ENV_NAME-$STAMP
[ -f "$ENV_FILE" ] || { echo "falta $ENV_FILE" >&2; exit 1; }

# disco compartilhado (já encheu uma vez): build precisa de folga
FREE_KB=$(df --output=avail -k / | tail -1 | tr -dc '0-9')
if [ "$FREE_KB" -lt $((2 * 1024 * 1024)) ]; then
  echo "menos de 2 GB livres ($((FREE_KB / 1024)) MB) — abortando antes do build" >&2
  exit 1
fi

VERSION="${3:-$(gzip -dc "$TARBALL" | git get-tar-commit-id 2>/dev/null || true)}"
VERSION="${VERSION:0:12}"
[ -n "$VERSION" ] || VERSION=sem-commit

mkdir -p "$BUILD"
trap 'rm -rf "$BUILD"' EXIT
tar -xzf "$TARBALL" -C "$BUILD"

echo "== build ($VERSION em $BUILD)"
cd "$BUILD"
set -a; . "$ENV_FILE"; set +a
nice -n 10 npm ci --no-audit --no-fund --loglevel=error
nice -n 10 npx next build > "$BUILD/build.log" 2>&1 || { tail -40 "$BUILD/build.log"; exit 1; }

echo "== release ($REL)"
bash "$BUILD/deploy/assemble-release.sh" "$BUILD" "$REL"
echo "$VERSION $(date -u +%FT%TZ)" > "$REL/VERSION"
cp "$BUILD/build.log" "$REL/build.log"
echo "release: $(du -sh "$REL" | cut -f1)"

echo "== systemd"
# ~/hackahub/ops é a cópia de deploy/ que o cron e a unit usam: atualiza
# junto com o release pra script novo (cron-call.sh, wait-pg.sh) não faltar
mkdir -p "$OPS" /home/ubuntu/hackahub/logs
# cópia + mv: este próprio deploy.sh pode estar rodando de $OPS, e o bash lê
# o script aos poucos; mv troca o arquivo sem mexer no que está aberto
for f in "$BUILD"/deploy/*.sh "$BUILD"/deploy/pg-roles.sql "$BUILD"/deploy/crontab.txt; do
  cp "$f" "$OPS/.$(basename "$f").new" && mv -f "$OPS/.$(basename "$f").new" "$OPS/$(basename "$f")"
done
chmod 755 "$OPS"/*.sh
UNIT=/etc/systemd/system/$SERVICE.service
# Hardening: NoNewPrivileges bloqueia sudo a partir do processo (o usuário
# ubuntu tem sudo sem senha), sistema só leitura, home só leitura (o
# /api/health lê o carimbo do backup), escrita só na pasta do ambiente.
sudo tee "$UNIT.new" >/dev/null <<UNITEOF
[Unit]
Description=HackaHub ($ENV_NAME)
After=network-online.target docker.service
Requires=docker.service

[Service]
User=ubuntu
WorkingDirectory=$BASE/current
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=PORT=$PORT
# sem HOSTNAME/-H: no Next 16.3 prender em 127.0.0.1 trava toda request
# (proxy interno do router). Porta fica fechada pra fora pela security list
# da OCI + o REJECT do iptables — só o Caddy (80/443) é público.
ExecStartPre=/bin/bash $OPS/wait-pg.sh
# release standalone sobe pelo server.js; release antigo (de antes do
# standalone) continua subindo pelo next start, pra o rollback funcionar
ExecStart=/bin/sh -c 'if [ -f server.js ]; then exec node server.js; else exec node node_modules/next/dist/bin/next start; fi'
Restart=always
RestartSec=3
Nice=5
MemoryMax=1536M
CPUQuota=200%
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$BASE
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNITEOF
if ! sudo cmp -s "$UNIT.new" "$UNIT"; then sudo mv "$UNIT.new" "$UNIT"; sudo systemctl daemon-reload; else sudo rm "$UNIT.new"; fi
sudo systemctl enable "$SERVICE" >/dev/null 2>&1

# rollback de código não desfaz migration: em prod, backup antes de trocar
if [ "$ENV_NAME" = prod ]; then
  echo "== backup antes do deploy"
  bash "$OPS/backup.sh" || { echo "backup falhou — abortando deploy (release fica em $REL, sem uso)" >&2; rm -rf "$REL"; exit 1; }
fi

PREV=$(readlink -f "$BASE/current" 2>/dev/null || true)
rollback() {
  echo "$1 — rollback" >&2
  sudo journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$BASE/current"; sudo systemctl restart "$SERVICE"
  fi
  exit 1
}
ln -sfn "$REL" "$BASE/current"
T0=$(date +%s)
sudo systemctl restart "$SERVICE"

echo "== health"
ok=0
for i in $(seq 1 40); do
  if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || rollback "health falhou"

# health só testa o banco: páginas SSR, OG e PDF leem do disco e pegam
# arquivo faltando no standalone ou escrita barrada pelo sandbox da unit
echo "== smoke"
case "$ENV_NAME" in prod) DBN=hackahub ;; *) DBN=hackahub_$ENV_NAME ;; esac
bash "$OPS/smoke.sh" "http://127.0.0.1:$PORT" "$DBN" || rollback "smoke falhou"
if sudo journalctl -u "$SERVICE" --since "@$T0" --no-pager | grep -E 'EROFS|ENOENT|EACCES'; then
  rollback "erro de disco no journal (EROFS/ENOENT/EACCES)"
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

echo "== limpeza (mantém 2 releases)"
ls -1dt "$BASE"/releases/* | tail -n +3 | xargs -r rm -rf
# tarball de release: stage e prod usam o mesmo; some depois do prod
if [ "$ENV_NAME" = prod ] && [ "$(dirname "$(readlink -f "$TARBALL")")" = /home/ubuntu/hackahub/tmp ]; then
  rm -f "$TARBALL"
fi

echo "ok: $ENV_NAME → $(readlink -f "$BASE/current") ($VERSION) em :$PORT ($HOSTS)"
