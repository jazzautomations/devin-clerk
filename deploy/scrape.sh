#!/usr/bin/env bash
# radar diário: roda o scraper do release atual do ambiente contra o banco dele
set -euo pipefail
ENV_NAME=${1:-stage}
DB=$( [ "$ENV_NAME" = prod ] && echo hackahub || echo hackahub_stage )
cd /home/ubuntu/hackahub/$ENV_NAME/current
DATABASE_URL=$(cat /home/ubuntu/hackahub-secrets/url.$DB) timeout 900 /home/ubuntu/hackahub/scraper/.venv/bin/python scripts/scrape_radar.py
