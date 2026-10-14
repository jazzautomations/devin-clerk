#!/usr/bin/env bash
# Monta um release a partir de um build do Next com output standalone:
# server.js + node_modules rastreados, .next/static e as pastas que o app lê
# do disco em runtime. Usado pelo deploy.sh e pelo standalone-smoke.sh, pra
# o gate testar exatamente o que vai pro servidor.
#   bash assemble-release.sh <pasta-do-build> <pasta-do-release> [dist=.next]
set -euo pipefail
SRC="${1:?pasta do build}"
REL="${2:?pasta do release}"
DIST="${3:-.next}"
[ -f "$SRC/$DIST/standalone/server.js" ] || { echo "sem $SRC/$DIST/standalone/server.js (build sem output standalone?)" >&2; exit 1; }
mkdir -p "$REL/$DIST"
cp -a "$SRC/$DIST/standalone/." "$REL/"
cp -a "$SRC/$DIST/static" "$REL/$DIST/static"
# migrations no boot, blog, fontes do certificado/crachá, runner do deploy
# tool, scraper do radar, scripts de ops e arquivos públicos
for d in migrations content assets scripts deploy public; do
  [ -d "$SRC/$d" ] && cp -a "$SRC/$d" "$REL/"
done
mkdir -p "$REL/data"
