#!/usr/bin/env bash
# Guarda de disco (cron a cada 10 min). A VPS é compartilhada.
# - ≥ 85%: registra ALERTA. O monitor externo vê o mesmo número no
#   /api/health?deep=1 (diskPct) e avisa no zap.
# - ≥ 90%: limpa só sobra do HackaHub: releases não-correntes, build de
#   e2e/dev, cache npm PRÓPRIO do HackaHub e tarballs de release antigos.
#   Nunca o ~/.npm do usuário (os outros produtos da máquina usam).
set -uo pipefail
USE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$USE" -lt 85 ] && exit 0
echo "$(date -u +%FT%TZ) ALERTA disco em ${USE}%"
[ "$USE" -lt 90 ] && exit 0
echo "$(date -u +%FT%TZ) limpando sobras do HackaHub"
for e in stage prod; do
  cur=$(readlink -f /home/ubuntu/hackahub/$e/current 2>/dev/null)
  for r in /home/ubuntu/hackahub/$e/releases/*; do
    [ -d "$r" ] && [ "$(readlink -f "$r")" != "$cur" ] && rm -rf "$r"
  done
done
rm -rf /home/ubuntu/hackahub-dev/.next-e2e /home/ubuntu/hackahub-dev/.next /home/ubuntu/hackahub-dev/.npm-cache
find /home/ubuntu/hackahub/tmp -maxdepth 1 -name 'hh-release*.tar.gz' -mmin +60 -delete 2>/dev/null
echo "$(date -u +%FT%TZ) depois: $(df --output=pcent / | tail -1 | tr -d ' ')"
