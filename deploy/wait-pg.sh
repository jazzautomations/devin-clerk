#!/usr/bin/env bash
# ExecStartPre das units hackahub-*: espera o container do Postgres aceitar
# conexão (até 30 s). Num reboot o app subia antes do banco e ficava em 503.
# Se o tempo acabar, sobe mesmo assim (sai 0): o lib/db tenta conectar de
# novo a cada request, e uma espera que trava o start travaria também o
# rollback do deploy.sh, que usa a mesma unit.
for _ in $(seq 1 30); do
  docker exec hackahub-pg pg_isready -U hackahub -q 2>/dev/null && exit 0
  sleep 1
done
echo "hackahub-pg não respondeu em 30 s; subindo o app assim mesmo" >&2
exit 0
