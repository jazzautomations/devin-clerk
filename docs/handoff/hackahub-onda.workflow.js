export const meta = {
  name: 'hackahub-onda',
  description: 'HackaHub: constrói uma onda do plano 046 (uma branch por feature, gate na VPS, revisão adversarial e correção)',
  phases: [
    { title: 'Build', detail: 'uma branch por feature, gate 100% verde na VPS' },
    { title: 'Review', detail: 'revisão adversarial por feature' },
    { title: 'Fix', detail: 'aplica achados confirmados e re-testa' },
  ],
}

const REPO = '/home/jazz/Projects/hackahub'
const BASE = args.base
const FEATURES = args.features

const urlFile = db => db === 'e2e' ? 'url.hackahub_e2e' : `url.hackahub_e2e_${db}`

const COMMON = (f) => `
Repo HackaHub em ${REPO} (Next 16.4.3, React 19, Tailwind v4, Clerk, Postgres). Plano da rede social: specs/046-rede-social/plano.json e sintese.md (a síntese tem prioridade). Estudos de base: specs/042 a 046. Leia AGENTS.md e siga as convenções: lib/db async, schema só em migrations/NNN_*.sql, copy PT-BR curta e concreta sem cara de GPT, sem emoji na UI, nunca atacar ferramenta, nunca escrever "Orkut" nem "quebra-gelo" em tela, 390px sem scroll horizontal. Lista "naoFazer" do plano.json é lei.
Crie a branch feat-${f.slug} a partir de ${BASE} no seu worktree (git checkout -b feat-${f.slug} ${BASE}). Migration reservada: ${f.migration || 'nenhuma (se precisar, use o próximo número livre acima de 058 e avise)'}.
Commits PT-BR no estilo do git log, terminando com: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
NUNCA faça git push, deploy, nem toque em prod/stage (~/hackahub, ~/hackahub-secrets/*.env, systemctl).

Testes SEMPRE na VPS (ssh ubuntu@64.181.217.112):
- sync: \`git archive HEAD | ssh ubuntu@64.181.217.112 'D=~/hackahub-wt-${f.slug}; mkdir -p $D && cd $D && find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .next ! -name .next-e2e ! -name .env.local -exec rm -rf {} + ; tar -x'\`. Na 1ª vez: \`ssh ubuntu@64.181.217.112 'cp -al ~/hackahub-wt-next/node_modules ~/hackahub-wt-${f.slug}/ && cp ~/hackahub-wt-next/.env.local ~/hackahub-wt-${f.slug}/'\`. Se mudar package.json/lock, rode npm ci lá (aí os node_modules deixam de ser hardlink, tudo bem).
- unit: \`cd ~/hackahub-wt-${f.slug} && npm run lint && npm run typecheck && npx vitest run\`
- e2e (serializado por lock, pode esperar): \`cd ~/hackahub-wt-${f.slug} && E2E_DATABASE_URL=$(cat ~/hackahub-secrets/${urlFile(f.db)}) E2E_PORT=${f.port} flock ~/hh-e2e.lock npm run test:e2e -- --reporter=line > /tmp/hh-${f.slug}-e2e.log 2>&1; grep -E "passed|failed|flaky" /tmp/hh-${f.slug}-e2e.log | tail -5\` (use run_in_background/timeout grande; espere terminar).
- Não mate processo que não é seu. Só use o diretório ~/hackahub-wt-${f.slug}.
Gate: lint, typecheck, vitest e e2e 100% verdes (a suíte inteira, não só os seus testes). Escreva testes unit/API e e2e pra tudo que criar.
`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, worktree: { type: 'string' }, lastCommit: { type: 'string' },
    summary: { type: 'string' }, migrations: { type: 'array', items: { type: 'string' } },
    unit: { type: 'string' }, e2e: { type: 'string' }, allGreen: { type: 'boolean' },
    contratos: { type: 'string', description: 'funções/tipos/rotas que as próximas ondas podem importar' },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'lastCommit', 'summary', 'allGreen', 'unit', 'e2e'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    file: { type: 'string' }, line: { type: 'number' }, problem: { type: 'string' },
    evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['severity', 'file', 'problem', 'evidence', 'fix'] } } },
  required: ['findings'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: { lastCommit: { type: 'string' }, unit: { type: 'string' }, e2e: { type: 'string' }, allGreen: { type: 'boolean' },
    resolved: { type: 'array', items: { type: 'string' } }, rejected: { type: 'array', items: { type: 'string' } } },
  required: ['lastCommit', 'allGreen', 'unit', 'e2e'],
}

const results = await pipeline(
  FEATURES,
  f => agent(`${COMMON(f)}
FEATURE: "${f.slug}". A spec completa está em specs/046-rede-social/plano.json (procure o objeto com "slug": "${f.slug}"; leia "spec", "arquivos", "dependeDe"). Os ajustes "AJUSTE DO DONO" no fim da spec têm prioridade. Toque só nos arquivos listados (outras features da mesma onda rodam em paralelo); se precisar de outro arquivo compartilhado, mude o mínimo.
Implemente completo (backend, UI caprichada no sistema visual do repo, permissões, rate limit, estados vazios, 390px), testes, gate 100% verde na VPS, commite. No retorno, descreva os contratos exportados pras próximas ondas.`, { label: `build:${f.slug}`, phase: 'Build', schema: IMPL_SCHEMA, isolation: 'worktree' }),
  (impl, f) => impl && agent(`Revisão ADVERSARIAL da feature "${f.slug}" do HackaHub. Diff: \`git -C ${REPO} diff ${BASE}...${impl.branch}\` (worktree ${impl.worktree}). Spec: specs/046-rede-social/plano.json, slug "${f.slug}" (+ sintese.md e lista naoFazer).
Procure só problemas REAIS verificados lendo o código: permissão/IDOR, dado privado exposto, bloqueio/denúncia furados, SQL errado no Postgres, migration que quebra dado existente ou conflita, race/idempotência, XSS/URL não validada, rate limit faltando, farm de XP/rep, violação do naoFazer, spec não cumprida, UI quebrada em 390px, copy com emoji/cara de GPT, teste que não testa nada. Cada achado com cenário concreto. Sem estilo, sem especulação. Nada real → findings vazio. NÃO edite arquivos.`, { label: `review:${f.slug}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' })
    .then(r => ({ impl, findings: (r && r.findings) || [] })),
  (rv, f) => {
    if (!rv) return null
    if (!rv.findings.length) return { feature: f.slug, ...rv.impl, findings: [], fix: null }
    return agent(`${COMMON(f)}
Trabalhe DIRETO no worktree ${rv.impl.worktree} (branch ${rv.impl.branch}), não crie outro nem outra branch. Um revisor apontou os achados abaixo. Para cada um: confirme lendo o código; se real, corrija e cubra com teste; se não, explique. Depois gate completo na VPS (lint, typecheck, vitest, e2e) 100% verde e commite.
ACHADOS:
${JSON.stringify(rv.findings, null, 2)}`, { label: `fix:${f.slug}`, phase: 'Fix', schema: FIX_SCHEMA })
      .then(fx => ({ feature: f.slug, ...rv.impl, findings: rv.findings, fix: fx }))
  },
)
return results
