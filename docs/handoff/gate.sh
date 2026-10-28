#!/usr/bin/env bash
# gate completo do HEAD atual na VPS (dir ~/hackahub-wt-integra), banco e2e_c, porta 3177
set -uo pipefail
cd /home/jazz/Projects/hackahub
git archive HEAD | ssh ubuntu@64.181.217.112 'D=~/hackahub-wt-integra; mkdir -p $D && cd $D && find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .next ! -name .next-e2e ! -name .env.local -exec rm -rf {} + ; tar -x; [ -d node_modules ] || cp -al ~/hackahub-wt-next/node_modules . ; [ -f .env.local ] || cp ~/hackahub-wt-next/.env.local .'
ssh ubuntu@64.181.217.112 'cd ~/hackahub-wt-integra
if ! cmp -s package-lock.json node_modules/.package-lock.json 2>/dev/null; then npm ci --no-audit --no-fund >/tmp/integra-ci.log 2>&1 || { echo NPM_CI_FAIL; tail -20 /tmp/integra-ci.log; exit 1; }; fi
npm run lint >/tmp/integra.log 2>&1 || { echo LINT_FAIL; tail -40 /tmp/integra.log; exit 1; }
npm run typecheck >>/tmp/integra.log 2>&1 || { echo TC_FAIL; tail -40 /tmp/integra.log; exit 1; }
npx vitest run > /tmp/integra-vitest.log 2>&1; grep -E "Tests |Test Files|FAIL" /tmp/integra-vitest.log | tail -15
E2E_DATABASE_URL=$(cat ~/hackahub-secrets/url.hackahub_e2e_c) E2E_PORT=3177 flock ~/hh-e2e.lock npm run test:e2e -- --reporter=line > /tmp/integra-e2e.log 2>&1
grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)" -A12 /tmp/integra-e2e.log | head -30'
