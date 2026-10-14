#!/usr/bin/env bash
# Backup diário do HackaHub (roda via cron do usuário ubuntu na VPS).
# pg_dump -Fc de prod e stage → ~/hackahub-backups/<stamp>/ (14 dias locais)
# + cópia fora da máquina no Object Storage da OCI por um link pré-autenticado
# SÓ DE ESCRITA (a VPS não consegue ler nem apagar backup; o bucket expira
# objetos com 60 dias). Grava o carimbo do último sucesso pro monitor.
set -euo pipefail
ROOT=/home/ubuntu/hackahub-backups
SECRETS=/home/ubuntu/hackahub-secrets
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=$ROOT/$STAMP
mkdir -p "$DIR"
for db in hackahub hackahub_stage; do
  docker exec hackahub-pg pg_dump -U hackahub -Fc "$db" > "$DIR/$db.dump"
  [ -s "$DIR/$db.dump" ] || { echo "dump vazio: $db" >&2; exit 1; }
done
( cd "$DIR" && sha256sum ./*.dump > SHA256SUMS )

if [ -f "$SECRETS/backup-par.url" ]; then
  PAR=$(cat "$SECRETS/backup-par.url")
  for f in "$DIR"/*; do
    curl -fsS -m 300 -X PUT --data-binary @"$f" "${PAR}hackahub/$STAMP/$(basename "$f")" >/dev/null
  done
  echo "offsite ok"
else
  echo "sem backup-par.url — só cópia local" >&2
fi

ls -1d "$ROOT"/*/ | sort | head -n -14 | xargs -r rm -rf
date -u +%FT%TZ > "$ROOT/LAST_OK"
echo "backup ok: $DIR ($(du -sh "$DIR" | cut -f1))"
