#!/usr/bin/env bash
# empacota o HEAD, sobe no stage; prod é o comando liberado (prod.sh)
set -euo pipefail
cd /home/jazz/Projects/hackahub
S=${TMPDIR:-/tmp}
git archive --format=tar.gz -o $S/hh.tar.gz HEAD
scp -q $S/hh.tar.gz ubuntu@64.181.217.112:~/hackahub/tmp/hh-release.tar.gz
ssh ubuntu@64.181.217.112 'cd ~/hackahub/tmp && tar -xzf hh-release.tar.gz deploy && bash deploy/deploy.sh stage ~/hackahub/tmp/hh-release.tar.gz 2>&1 | tail -3'
