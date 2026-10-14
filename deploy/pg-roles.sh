#!/usr/bin/env bash
# Aplica deploy/pg-roles.sql e passa o dono de tudo que está dentro de cada
# banco pro role dele (F4). Rodar UMA vez, na VPS, como ubuntu:
#   bash ~/hackahub/ops/pg-roles.sh
# Gera as senhas e grava as URLs novas em ~/hackahub-secrets/url.hh_<env>
# (600). NÃO mexe em prod.env/stage.env nem reinicia nada: isso é o passo
# seguinte, manual (docs/runbook.md, "Roles do Postgres").
set -euo pipefail
OPS=$(cd "$(dirname "$0")" && pwd)
SECRETS=${HACKAHUB_SECRETS_DIR:-/home/ubuntu/hackahub-secrets}
PSQL=(docker exec -i hackahub-pg psql -U hackahub -v ON_ERROR_STOP=1 -qtA)

umask 077
for r in prod stage dev; do
  f=$SECRETS/pw.hh_$r
  [ -s "$f" ] || openssl rand -hex 24 > "$f"
done
"${PSQL[@]}" -d postgres \
  -v pw_prod="$(cat "$SECRETS/pw.hh_prod")" \
  -v pw_stage="$(cat "$SECRETS/pw.hh_stage")" \
  -v pw_dev="$(cat "$SECRETS/pw.hh_dev")" < "$OPS/pg-roles.sql"

owner_of() {
  case "$1" in hackahub) echo hh_prod ;; hackahub_stage) echo hh_stage ;; *) echo hh_dev ;; esac
}

DBS=$("${PSQL[@]}" -d postgres -c "SELECT datname FROM pg_database
  WHERE datname IN ('hackahub','hackahub_stage','hackahub_dev') OR datname LIKE 'hackahub\_e2e%' ORDER BY 1")
for db in $DBS; do
  o=$(owner_of "$db")
  "${PSQL[@]}" -d "$db" -v owner="$o" <<'SQL'
SELECT set_config('hh.owner', :'owner', false);
DO $do$
DECLARE r record; o text := current_setting('hh.owner');
BEGIN
  EXECUTE format('ALTER SCHEMA public OWNER TO %I', o);
  -- tabela leva junto a sequência de identity/serial dela
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
              AND NOT (c.relkind = 'S' AND EXISTS (
                SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i')))
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO %I',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                     WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.relname, o);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO %I', r.sig, o);
  END LOOP;
END $do$;
SQL
  echo "$db → $o"
done

for r in prod stage dev; do
  case $r in prod) db=hackahub ;; stage) db=hackahub_stage ;; dev) db=hackahub_dev ;; esac
  echo "postgres://hh_$r:$(cat "$SECRETS/pw.hh_$r")@127.0.0.1:5434/$db" > "$SECRETS/url.hh_$r"
done
echo "ok. URLs novas em $SECRETS/url.hh_{prod,stage,dev} (não impressas)."
