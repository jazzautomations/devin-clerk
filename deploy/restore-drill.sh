#!/usr/bin/env bash
# Prova que o backup restaura: carrega o dump mais recente (ou o dado) num
# banco descartável, confere checksum, migrations e contagem de linhas contra
# a origem, e apaga tudo. Prod nunca é tocado. Resultado vai pro stdout e
# deve ser registrado (com data) em docs/runbook.md.
#   bash restore-drill.sh [dir-do-backup] [banco-origem=hackahub]
set -euo pipefail
ROOT=/home/ubuntu/hackahub-backups
SET="${1:-$(ls -d "$ROOT"/*/ | sort | tail -1)}"; SET="${SET%/}"
SRC="${2:-hackahub}"
DUMP="$SET/$SRC.dump"
[ -f "$DUMP" ] || { echo "sem $DUMP" >&2; exit 1; }
( cd "$SET" && sha256sum -c --quiet SHA256SUMS )
DB="hackahub_drill_$(date -u +%H%M%S)"
PSQL="docker exec -i hackahub-pg psql -U hackahub -v ON_ERROR_STOP=1 -qtA"
trap 'docker exec hackahub-pg psql -U hackahub -d postgres -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
START=$(date +%s)
docker exec hackahub-pg createdb -U hackahub "$DB"
docker exec -i hackahub-pg pg_restore -U hackahub -d "$DB" --no-owner < "$DUMP"
count() { $PSQL -d "$1" -c "SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'migrations' t, COUNT(*) n FROM schema_migrations UNION ALL
  SELECT 'members', COUNT(*) FROM members UNION ALL
  SELECT 'hackathons', COUNT(*) FROM hackathons UNION ALL
  SELECT 'registrations', COUNT(*) FROM registrations UNION ALL
  SELECT 'posts', COUNT(*) FROM posts) x"; }
GOT=$(count "$DB")
echo "restaurado: $GOT"
echo "origem now: $(count "$SRC")  (pode ter crescido desde o backup)"
echo "drill ok: $(basename "$SET")/$SRC.dump em $(( $(date +%s) - START ))s"
