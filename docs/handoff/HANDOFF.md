# Handoff: rede social do HackaHub (pausa em 28/10/2026)

O plano está em `specs/046-rede-social/plano.json` e `sintese.md`. A síntese tem prioridade sobre o plano. Os estudos de base estão em `specs/042` (quebra-gelo), `043` (gamificação), `044` (Orkut), `045` (conexão) e `046` (plano, crítica e pesquisa).

## Onde parou

### Em prod e stage: `247adc6` (main)

| Onda | Feature | Migration |
|---|---|---|
| 0 | evidência + LGPD extensível + `canNetwork` + `lastSeenAt` + `actorId` | 031 |
| 0 | bloqueio, silêncio e denúncia com fila única | 032 |
| 1 | seguir pessoas | 033 |
| 1 | conversa no post: `/post/[id]`, 4 reações, respostas, edição, moderação | 034 |

### Integrado e verde, mas fora do main: branch `integra-indep`

- **O que tem:** main mais `notificacoes-boas` (040), `busca-global` (042), `agenda-da-comunidade` (051), `desafios-abertos` (053) e `metricas-e-checkpoint`.
- **Gate completo na VPS:** 1708 unit (2 skipped) e 368 e2e, tudo passando.
- **Pra subir:**
  1. `git checkout main && git merge --ff-only integra-indep && git push private main`
  2. `bash docs/handoff/ship.sh` (stage)
  3. `ssh ubuntu@64.181.217.112 'bash ~/hackahub/tmp/prod.sh'` (prod; o comando já está liberado no `settings.local.json`)
- **Pendente do dono:** o resumo semanal só envia de verdade com o crontab novo instalado (`deploy/crontab.txt`, linhas do digest).

### Onda 1 em andamento

O workflow `wf_237ad171-833` foi interrompido. As branches estão no repo local e cada uma foi feita a partir do main antigo (`abd3fcd`):

| Branch | Estado |
|---|---|
| `feat-nivel-por-entrega` (035) | build, review e fix feitos; fix sem resultado final registrado. Rodar o gate. |
| `feat-vitrine-de-projeto` (036) | build e review feitos; fix interrompido. |
| `feat-depoimento-de-time` (037) | build e review feitos; fix interrompido (último commit é `wip`). |
| `feat-bicho-motor-e-criador` (043) | build e review feitos; fix não começou. |
| `feat-topicos-da-comunidade` (058) | build e review feitos; fix não começou. |

**Como retomar:** relançar com o cache. As etapas que já fecharam voltam prontas, e as interrompidas rodam de novo; o agente precisa reaproveitar a branch e o worktree que já existem.

```
Workflow({scriptPath: "docs/handoff/hackahub-onda.workflow.js", resumeFromRunId: "wf_237ad171-833",
  args: {"base":"main","features":[
    {"slug":"seguir-pessoas","migration":"033","db":"a","port":3190},
    {"slug":"conversa-no-post","migration":"034","db":"b","port":3191},
    {"slug":"nivel-por-entrega","migration":"035","db":"d","port":3192},
    {"slug":"vitrine-de-projeto","migration":"036","db":"h","port":3193},
    {"slug":"depoimento-de-time","migration":"037","db":"i","port":3194},
    {"slug":"bicho-motor-e-criador","migration":"043","db":"j","port":3195},
    {"slug":"topicos-da-comunidade","migration":"058","db":"e2e","port":3196}]}})
```

O resume só funciona na mesma sessão. Numa sessão nova, rode o mesmo script sem `resumeFromRunId`, só com as 5 features que faltam, e diga no prompt que a branch `feat-<slug>` já existe e é pra continuar dela: revisar, corrigir e fechar o gate.

### Ondas que ainda não começaram

| Onda | Features |
|---|---|
| 2 | `timeline` (038), `mencoes-e-tags` (039), `perfil-rico` (041, com recado no perfil) |
| 3 | `projeto-vivo` (044), `vagas-de-time` (045), `comunidade-dona-do-espaco` (046) |
| 4 | `bicho-avatar-e-evolucao` (047), `telao-e-bicho-do-time` (048), `repost-e-citacao` (049) |
| 5 | `encontros-na-edicao` (050, leve e opcional), `quatro-semanas` (052), `liga-por-faixa` (054) |
| 6 | `copilot-do-arquivo` (055, LLM opcional), `dm-com-trava` (056), `espacos-da-comunidade` (057), `rss-aberto` |

As migrations já estão reservadas no `plano.json`.

## Como trabalhar (o que funcionou)

- **Uma branch por feature.** O workflow `docs/handoff/hackahub-onda.workflow.js` faz build, revisão adversarial e correção. Os args são `{base, features:[{slug, migration, db, port}]}`.
- **Diretório:** dispare o workflow com o cwd **dentro do repo**. Fora dele a criação de worktree falha, e isso derrubou 5 features uma vez.
- **Paralelismo:** o workflow roda no máximo 2 agentes por vez (o notebook tem 4 núcleos). Dá pra rodar 2 workflows em paralelo.
- **Testes:** sempre na VPS (`ssh ubuntu@64.181.217.112`), num diretório `~/hackahub-wt-<slug>` por feature, com `node_modules` em hardlink de `~/hackahub-wt-next`.
  - **e2e serializado:** todos rodam um de cada vez pelo `flock ~/hh-e2e.lock`. Por isso os bancos `hackahub_e2e_*` podem ser compartilhados.
  - **Banco reservado:** o `_c` é do gate de integração.
- **Integração por lote:**
  1. `git checkout -b integra-X main`
  2. merge das branches
  3. conflitos de "dois lados adicionaram" (`lib/ratelimit.ts`, `AGENTS.md`): `python3 docs/handoff/union.py <arquivo>`
  4. `bash docs/handoff/gate.sh` (passa de 10 min; rodar em background)
  5. ff no main, push, `ship.sh`, depois `prod.sh`
- **Disco da VPS:** está em 85–87%. Depois de integrar, apague `~/hackahub-wt-<slug>` das features já mergeadas. Nunca apague `~/hackahub-wt-next` nem `~/hackahub-wt-com`; esse último tem um processo antigo que não é nosso.
- **Migrations:** o runner registra por nome em `schema_migrations`, então número fora de ordem funciona.
- **Coluna nova em `members`:** registre em `ANONYMIZE` ou `KEEP_ON_ANONYMIZE`, senão `tests/api/privacy-anonymize.test.ts` falha.
- **Tipo novo de notificação:** registre em `TYPE_GROUP` (`lib/notifications.ts`).

## Pendências do dono

- Clerk de produção: Configure → Legal → "Require express consent", com links pra `/legal/termos` e `/legal/privacidade`.
- Trocar o `GITHUB_TOKEN` por um fine-grained só de leitura. Ele está em `~/hackahub-secrets/{prod,stage}.env`.
- Reinstalar o crontab (`crontab ~/hackahub/ops/crontab.txt`) por causa do digest.
- O copilot só gera resumo com `COPILOT_LLM_URL`, `COPILOT_LLM_KEY` e modelo no env. Sem isso funciona só com resultados.
