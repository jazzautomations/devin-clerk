#!/usr/bin/env bash
# Backup diário do HackaHub (roda via cron do usuário ubuntu na VPS).
# pg_dump -Fc de prod e stage → ~/hackahub-backups/<stamp>/ (14 dias locais)
# + cópia fora da máquina no Object Storage da OCI por um link pré-autenticado
# SÓ DE ESCRITA (a VPS não consegue ler nem apagar backup; o bucket expira
# objetos com 60 dias). Grava o carimbo do último sucesso (LAST_OK), que o
# /api/health?deep=1 expõe pro monitor externo.
#
# Segredos (opcional, F6): com `age` instalado e a chave PÚBLICA em
# ~/hackahub-secrets/backup-age.pub, o env de prod/stage, o pg.env e o link
# do bucket vão juntos, cifrados, como secrets.tar.age. Só quem tem a chave
# privada (fora da VPS) abre. Sem a chave pública, o passo é pulado.
#
# Ping (opcional): ~/hackahub-secrets/hc-backup.url (ex.: Healthchecks.io)
# recebe GET no sucesso e GET <url>/fail na falha.
set -euo pipefail
ROOT=/home/ubuntu/hackahub-backups
SECRETS=/home/ubuntu/hackahub-secrets
LOGS=/home/ubuntu/hackahub/logs
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=$ROOT/$STAMP
HC=$(cat "$SECRETS/hc-backup.url" 2>/dev/null || true)
ping_hc() { [ -n "$HC" ] && curl -fsS -m 10 "$HC$1" >/dev/null 2>&1 || true; }
trap 'echo "$(date -u +%FT%TZ) backup FALHOU (linha $LINENO)" >&2; ping_hc /fail' ERR

mkdir -p "$DIR"
for db in hackahub hackahub_stage; do
  docker exec hackahub-pg pg_dump -U hackahub -Fc "$db" > "$DIR/$db.dump"
  [ -s "$DIR/$db.dump" ] || { echo "dump vazio: $db" >&2; false; }
done

if command -v age >/dev/null 2>&1 && [ -s "$SECRETS/backup-age.pub" ]; then
  tar -C "$SECRETS" -cf - $(cd "$SECRETS" && ls -1 prod.env stage.env pg.env backup-par.url 2>/dev/null) \
    | age -R "$SECRETS/backup-age.pub" -o "$DIR/secrets.tar.age"
fi
( cd "$DIR" && sha256sum ./*.dump $( [ -f "$DIR/secrets.tar.age" ] && echo ./secrets.tar.age ) > SHA256SUMS )

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

# logs dos crons: corta o que passar de 5 MB pra os últimos 2 MB
for f in "$LOGS"/*.log; do
  [ -f "$f" ] || continue
  if [ "$(stat -c %s "$f")" -gt 5242880 ]; then
    tail -c 2097152 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

date -u +%FT%TZ > "$ROOT/LAST_OK"
ping_hc ""
echo "backup ok: $DIR ($(du -sh "$DIR" | cut -f1))"
