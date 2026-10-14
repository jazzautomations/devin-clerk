#!/usr/bin/env bash
# Guarda de disco (cron a cada 10 min). A VPS é compartilhada: se o uso passar
# de 90%, limpa só sobra de build do HackaHub (releases não-correntes, caches
# de e2e/dev) e registra o alerta. Nunca toca em outra pasta ou serviço.
set -uo pipefail
USE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$USE" -lt 90 ] && exit 0
echo "$(date -u +%FT%TZ) ALERTA disco em ${USE}% — limpando sobras do HackaHub"
for e in stage prod; do
  cur=$(readlink -f /home/ubuntu/hackahub/$e/current 2>/dev/null)
  for r in /home/ubuntu/hackahub/$e/releases/*; do
    [ -d "$r" ] && [ "$(readlink -f "$r")" != "$cur" ] && rm -rf "$r"
  done
done
rm -rf /home/ubuntu/hackahub-dev/.next-e2e /home/ubuntu/hackahub-dev/.next
npm cache clean --force >/dev/null 2>&1
echo "$(date -u +%FT%TZ) depois: $(df --output=pcent / | tail -1 | tr -d ' ')"
