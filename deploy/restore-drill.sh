#!/usr/bin/env bash
# Prova que o backup restaura: carrega o dump mais recente (ou o dado) num
# banco descartável, confere checksum, conta as linhas de TODAS as tabelas e
# compara com a origem, e apaga tudo. O banco de origem nunca é tocado (só
# leitura pra comparar). No sucesso grava ~/hackahub-backups/LAST_DRILL_OK-<banco>.
# O /api/health?deep=1 expõe só o de prod (LAST_DRILL_OK-hackahub) pro monitor
# externo (alerta com > 8 dias): o drill do stage não pode esconder um drill
# de prod que falha.
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

# contagem exata de cada tabela do schema public (pg_stat_user_tables só
# estima, e num banco recém-restaurado ainda está zerado)
count() {
  local q
  q=$($PSQL -d "$1" -c "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', relname, relname), ' UNION ALL ' ORDER BY relname) FROM pg_stat_user_tables WHERE schemaname = 'public'")
  [ -n "$q" ] || { echo ""; return; }
  $PSQL -d "$1" -c "SELECT t || '=' || n FROM ($q) x ORDER BY t"
}
GOT=$(count "$DB")
ORIG=$(count "$SRC")
NT=$(printf '%s\n' "$GOT" | grep -c '=' || true)
[ "$NT" -gt 0 ] || { echo "restauração sem tabelas" >&2; exit 1; }
printf '%s\n' "$GOT" | grep -q '^schema_migrations=[1-9]' || { echo "sem schema_migrations" >&2; exit 1; }

echo "restaurado: $NT tabelas"
# diferenças contra a origem (a origem pode ter crescido desde o backup)
diff <(printf '%s\n' "$GOT") <(printf '%s\n' "$ORIG") | sed -n 's/^</  backup: /p; s/^>/  agora:  /p' || true
date -u +%FT%TZ > "$ROOT/LAST_DRILL_OK-$SRC"
echo "drill ok: $(basename "$SET")/$SRC.dump em $(( $(date +%s) - START ))s"
