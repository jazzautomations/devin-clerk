#!/usr/bin/env bash
# Sobe o Postgres do HackaHub isolado: container próprio, só em 127.0.0.1:5434,
# limite de memória, volume próprio. Idempotente. Não toca em nenhum outro container.
set -euo pipefail
ENV_DIR=/home/ubuntu/hackahub-secrets
mkdir -p "$ENV_DIR" && chmod 700 "$ENV_DIR"
if [ ! -f "$ENV_DIR/pg.env" ]; then
  umask 077
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > "$ENV_DIR/pg.env"
fi
if ! docker ps -a --format '{{.Names}}' | grep -qx hackahub-pg; then
  docker run -d --name hackahub-pg --restart unless-stopped \
    --env-file "$ENV_DIR/pg.env" -e POSTGRES_USER=hackahub -e POSTGRES_DB=hackahub \
    -p 127.0.0.1:5434:5432 --memory 1g --cpus 2 \
    -v hackahub-pgdata:/var/lib/postgresql/data \
    postgres:17-alpine >/dev/null
fi
for i in $(seq 1 30); do docker exec hackahub-pg pg_isready -U hackahub -q && break; sleep 1; done
for db in hackahub_stage hackahub_e2e hackahub_dev; do
  docker exec hackahub-pg psql -U hackahub -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || docker exec hackahub-pg createdb -U hackahub "$db"
done
# query lenta (> 500 ms) aparece no log do container: docker logs hackahub-pg
docker exec hackahub-pg psql -U hackahub -qtAc "ALTER SYSTEM SET log_min_duration_statement = 500" >/dev/null
docker exec hackahub-pg psql -U hackahub -qtAc "SELECT pg_reload_conf()" >/dev/null
docker exec hackahub-pg psql -U hackahub -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'hackahub%' ORDER BY 1"
