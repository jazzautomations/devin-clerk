# Plano de correção do HackaHub

> Base: `main` @ **f44675c**. A auditoria foi feita em 86b7939 e alguns achados citam ea0bab4. Antes de começar, cada pacote confere as linhas no HEAD, porque algumas já andaram: a parte "sem porta no dashboard" do `convite-equipe` já foi resolvida.
> A migration 018 já existe (`018_lead_organizar_onboarding.sql`). Os pacotes usam números fixos (019–022) pra não colidirem rodando em paralelo.

## Resumo executivo

1. **Nível hoje: MVP tardio, ainda não Produção.** Os fluxos completos existem (inscrição, time, entrega, júri, palco, check-in, certificado), mas faltam a base de operação e algumas regras de negócio.
2. **Pior problema 1:** o Next 16.3.5 tem uma falha crítica que permite executar código no servidor pela geração de imagem de compartilhamento, e o app gera essa imagem com texto digitado pelo usuário. Corrige hoje.
3. **Pior problema 2:** salvar qualquer campo da edição apaga o fuso e adianta o evento em 3h. Isso desalinha RSVP, lembretes, NPS, prazo de inscrição e exclusão LGPD.
4. **Pior problema 3:** quem cancela a inscrição ou exclui a conta continua no time e trava a entrega do time inteiro. Não existe "sair do time" nem "remover integrante".
5. **Pior problema 4:** prod roda sem e-mail, sem WhatsApp e sem admin. Ingresso, RSVP e aviso ao responsável de menor ficam como "pulado" em silêncio, o RSVP pode expirar a vaga de quem nunca recebeu o convite e ninguém administra a plataforma.
6. **Pior problema 5:** se o site cair, ninguém fica sabendo. Os 84 commits só existem no notebook, e o stage usa o mesmo superusuário do Postgres que consegue apagar o banco de prod.
7. **Depois dos pacotes:** nenhum CVE crítico ou alto, datas sempre em horário de Brasília e inscrição/cancelamento com regra (prazo, evento começado, recusa, XP pago uma vez só).
8. O organizador passa a operar a própria edição sozinho: configurar, aprovar e recusar, checklist por fase, rascunho antes de publicar.
9. O júri só publica com avaliação completa, o pódio fica congelado e quem foi recusado, aprovado, premiado ou recebeu feedback é avisado. A interface para de prometer e-mail quando o e-mail está desligado.
10. Na operação: tela de erro própria com código de referência, log com rota, banco que se recupera sozinho, backup antes de cada deploy e alerta no zap. Com a lista do fundador feita, chega a **Produção**.

---

## 1. Lista do fundador (area="fundador")

O Jazz faz estes itens. Nenhum agente pode, seja por precisar de conta, de DNS, de VPS (serviços, cron, env) ou de decisão jurídica. Em ordem de urgência:

| # | Achado(s) | O que fazer | Bloqueia |
|---|---|---|---|
| F1 | `admins-prod-vazio`, `ops-env-prod-faltando` | Preencher `HACKAHUB_ADMIN_EMAILS` em prod.env e stage.env (o teu e-mail e o do responsável da Hack Inova) e reiniciar os serviços. | Operar qualquer edição |
| F2 | `email-dominio-dmarc`, `email-prometido-*`, `email-responsavel-reply-placeholder` | Criar conta Resend, verificar um subdomínio de envio e pôr `RESEND_API_KEY`, `HACKAHUB_EMAIL_FROM` (domínio real, **não** hackahub.dev), `RESEND_WEBHOOK_SECRET` e um reply-to real em prod.env. Criar no DNS `_dmarc TXT "v=DMARC1; p=none; rua=mailto:…"` e ativar DNSSEC. Opcional: EVOLUTION_* pro zap. | Ingresso, RSVP, aviso ao responsável |
| F3 | `codigo-so-no-notebook` | Criar o repo **privado** `jazzautomations/hackahub` e fazer `git push private main`. Arquivar o fork público `devin-clerk`. Mudar no AGENTS.md "Sem push" pra "push só pro remoto privado". | CI do pacote A |
| F4 | `pg-superuser-compartilhado` | Rodar o `deploy/pg-roles.sql` que o pacote A prepara (cria hh_prod, hh_stage e hh_dev, sem superuser), trocar os DATABASE_URL e reiniciar numa janela curta. Teste: com a URL de stage, `psql -d hackahub` tem que falhar. | Trilha de auditoria (onda 2) |
| F5 | `sem-alerta-nenhum`, `sem-monitor-uptime` | Instalar no imac-server o checker que o pacote A entrega (`deploy/monitor/`, alerta pelo Evolution). Opcional: conta Healthchecks.io pra pingar os crons. | — |
| F6 | `segredos-sem-backup` | Guardar prod.env, pg.env e backup-par.url (o TICKET_SECRET é o mais importante) num gerenciador de senhas com acesso de emergência, ou criar a chave `age` pro `secrets.tar.age` que o pacote A põe no backup. | — |
| F7 | Pacote A, itens de VPS | Aplicar na VPS o que o pacote A versionar: `crontab deploy/crontab.txt`, nova unit com hardening (`servico-root-equivalente`) e drill de prod no cron. | — |
| F8 | `lgpd-politica-incompleta`, `privacidade-incompleta` | Com advogado: definir quem é o controlador (razão social e CNPJ), nomear o encarregado e criar o e-mail privacidade@. O pacote E escreve a página, mas precisa desses dados. | — |
| F9 | `eca-digital-menores` | Decidir se o HackaHub aceita menor. Se não aceitar, o pacote B fixa minAge ≥ 18. Se aceitar, o fluxo de confirmação do responsável vai pra onda 2. | — |
| F10 | `termos-plataforma-sem-aceite` | No Clerk, ligar Legal → "Require express consent" apontando pra /legal/termos e /legal/privacidade. Revisar os termos (canal de denúncia, processo de remoção). | — |
| F11 | `bus-factor-contas`, `status-suporte-versao` | Convidar um segundo admin no Clerk, no Vercel DNS e na OCI. MFA com códigos de recuperação fora do celular. Lembrete pra renovar o PAR do bucket em 2027-09. Criar suporte@ no ImprovMX. Renomear o app Clerk. | — |
| F12 | `staging-publico-indexavel` (parte Caddy) | Opcional: basic_auth no bloco `# hackahub-stage` do Caddy. | — |

## 2. Para a frente da landing (area="P")

| Achado | Sev. | Arquivo | O que repassar |
|---|---|---|---|
| `500-em-rota-estatica` / `500-asset-paths-clerk` | médio | proxy.ts:34, Header.tsx | `/x.png`, `/apple-touch-icon.png` e `/qualquer.js` dão 500 por causa do auth() fora do clerkMiddleware. O pacote A cobre os ícones que o navegador pede sozinho (app/icon.png, apple-icon.png, manifest.ts) e o global-error. O Header precisa aguentar a ausência de middleware. |
| `csrf-textplain-same-site` | baixo | proxy.ts | Exigir `Origin`/`Sec-Fetch-Site: same-origin` em métodos não-GET de /api/*, com exceção de webhooks, cron e rsvp/[token]. |
| `sem-csp` (parte nonce) | baixo | proxy.ts | O pacote A põe CSP em Report-Only no next.config. A versão com nonce é no proxy. |
| `bundle-clerk-global` | médio | app/layout.tsx, Header.tsx | ClerkProvider só nas rotas logadas e UserButton em ilha client: ~350 KB a menos em /blog, /telao e /votar. |
| `root-force-dynamic` | baixo | app/layout.tsx:55 | Tirar o `force-dynamic` da raiz. Blog e legal ficam estáticos ou com revalidate. |
| `sem-skip-link` | médio | app/layout.tsx:104 | Link "pular para o conteúdo" e `<main id="conteudo" tabIndex={-1}>`. |
| `bell-dropdown-cortado-390` + `notificationbell-poll-aba-oculta` | médio | NotificationBell.tsx | Painel fixed no mobile, alvo de 44px, devolver o foco no Esc e não fazer polling com `visibilityState !== 'visible'`. |
| `cartinha-mintar-prova-presenca` | médio | app/h/[id]/page.tsx:736-742 | Trocar "inscreve-te pra mintar" e "prova de presença" por "registro da sua inscrição". Esconder em evento devpost-*. |
| `status-aprovado-sem-proximo-passo` (banner) | médio | app/h/[id]/page.tsx | Ler `?inscricao=` e mostrar banner com os próximos passos. A parte de /inscricao fica no pacote C. |
| `cancelar-inscricao-sem-confirmacao` | alto | components/RegisterButton.tsx | **Só pra informar:** o conserto mexe só no componente, então o pacote C faz (confirmação e status separado da ação). |

---

## 3. Pacotes de trabalho (paralelos, em worktrees)

Regra de posse: **cada arquivo tem um único dono**. Quem precisa de algo do arquivo de outro pacote só importa, não edita. As correções de copy (trocar "tu" por "você", jargão, erro cru) são feitas por quem é dono do arquivo. O pacote E fica com os arquivos que não são de ninguém.

Ordem de merge: **A (commit do CVE sai sozinho, hoje) → B → C → D → E.** B vem antes de C porque C usa `parseEventStart` e `isRegistrationClosed`, que B corrige.

---

### Pacote A: plataforma, runtime e ops (inclui o hotfix do CVE)

**Objetivo:** fechar o CVE crítico, deixar o processo resiliente e observável e tornar deploy e backup seguros e baratos de disco.

**Achados (por severidade):**
- crítico: `next-rce-cve`
- alto: `db-promise-rejeitada-cacheada` (+ `db-driver-promessa-rejeitada-cacheada`), `sem-error-boundary` (+ `sem-error-boundary-tracking`), `sem-alerta-nenhum`/`sem-monitor-uptime` (lado do código), `segredos-sem-backup` (lado do backup.sh)
- médio: `pool-sem-error-handler-timeouts`, `sem-log-estruturado-sem-rota`, `currentmember-clerk-api-por-render`, `demo-proxy-vaza-sessao`, `sem-csp` (Report-Only), `sem-ci-build-na-vps`, `release-1gb-disco`, `deploy-sem-backup-previo`, `servico-root-equivalente`, `restore-so-stage-sem-rpo`, `deploy-tool-prometido-desligado`
- baixo: `pglite-wasm-servido-publico`, `staging-publico-indexavel` (robots), `security-txt-vdp`, `id-numerico-overflow-500`, `markdown-link-barra-invertida`, `og-image-sem-cache`, `status-suporte-versao` (versão no health), `runbook-desatualizado`, `cron-erro-sem-timestamp-e-intercalado`, `disk-guard-cego`, `restore-drill-so-stage`, `ops-env-prod-faltando` (rebaixar admin que sai da lista), `jargao-buildando…` (só no DeployPanel)

**Arquivos:**
- `package.json`, `package-lock.json`: next e eslint-config-next ≥ 16.3.8, `npm audit fix` (source-map-js). **Commit 1, isolado, sai em deploy hoje.** O build roda no notebook, nunca na VPS.
- `lib/db.ts`: `.catch` que zera `g.__hackahubDb`, `pool.on('error')`, `connectionTimeoutMillis: 5000`, `statement_timeout`/`idle_in_transaction_session_timeout`, `application_name`, ROLLBACK num try e `client.release(err)`.
- `lib/session.ts`: `cache()` em volta do currentMember, `getMemberByClerkId` primeiro e `currentUser()` só quando o membro ainda não existe.
- `lib/members.ts`: rebaixar a admin quem saiu da lista (ou documentar que é manual).
- `next.config.ts`: CSP em Report-Only, `serverExternalPackages: ['@electric-sql/pglite','pg']`, `output: 'standalone'`, `X-Robots-Tag: noindex` fora de prod.
- `instrumentation.ts` (novo): `onRequestError` grava JSON de uma linha com digest, path, routePath e method.
- `app/error.tsx`, `app/global-error.tsx` e `app/admin/h/[id]/error.tsx` (novos): PT-BR, digest como "código de referência", sem Clerk e sem Header no global.
- `app/icon.png`, `app/apple-icon.png`, `app/manifest.ts` (novos; avisar a P pra não duplicar).
- `app/api/health/route.ts`: `version` (vem do arquivo VERSION) e `?deep=1` com backupAgeH, idade da fila e diskPct.
- `app/.well-known/security.txt/route.ts` (novo), `lib/seo.ts` (robots disallow fora de prod).
- `lib/ids.ts` (novo, `parseId`), `app/p/[teamId]/page.tsx` (parseId, link de volta com py-3, estado vazio "o time ainda não publicou links"), `app/api/projects/[teamId]/deploy/route.ts`. Os outros ~44 usos de `Number.isInteger` ficam pra onda 2.
- `app/h/[id]/opengraph-image.tsx`, `app/p/[teamId]/opengraph-image.tsx`, `app/opengraph-image.tsx`: Cache-Control explícito.
- `app/demo/[id]/[[...path]]/route.ts`, `lib/deploys.ts`: remover Cookie, Authorization e x-clerk-* e não repassar Set-Cookie; `CSP: sandbox`; env do runner só com o necessário. Registrar no código que domínio separado é **obrigatório** antes de ligar `HACKAHUB_DEPLOY_TOOL`.
- `components/DeployPanel.tsx`: não renderizar quando os deploys estiverem desligados; copy "publicando…". `content/blog/deploy-da-demo-em-5-min.md`: despublicar ou reescrever sem `hackahub.dev`.
- `lib/blog.ts`: regex `/^\/(?![\/\\])/` e rel ugc em links de usuário.
- `deploy/deploy.sh`: backup antes do restart em prod (aborta se falhar), `npm prune --omit=dev && rm -rf .next/cache` (ou artefato standalone), checar ≥ 2 GB livres, gravar VERSION, unit com `NoNewPrivileges`/`PrivateTmp`/`ProtectSystem=strict` + ReadWritePaths, `ExecStartPre` com pg_isready, `Requires=docker.service`.
- `deploy/backup.sh`: `secrets.tar.age` no PUT offsite (se o F6 escolher age) e ping de sucesso/falha.
- `deploy/cron-call.sh` (novo wrapper com timestamp, log por env e rota, contador de falhas), `deploy/deliveries.sh`, `rsvp.sh` e `submissions.sh` passam a usar o wrapper.
- `deploy/restore-drill.sh`: contar todas as tabelas via pg_stat_user_tables e gravar LAST_DRILL_OK. `deploy/disk-guard.sh`: alerta em 85%, limpeza em 90%, não mexer no `~/.npm` compartilhado.
- `deploy/crontab.txt` (novo, fonte da verdade do cron, com drill de prod e de stage), `deploy/pg-roles.sql` (novo, F4), `deploy/pg-up.sh` (`log_min_duration_statement=500`), `deploy/monitor/check.sh` + README (novo, roda no imac-server e alerta via Evolution).
- `.github/workflows/ci.yml` (novo): lint, typecheck, vitest, `npm audit --omit=dev --audit-level=high` e build standalone, com actions fixadas por SHA. Só ativa depois do F3.
- `docs/runbook.md`: 4 correções (2 releases, crontab com submissions, deliveries/submissions, migrations), RPO 24h / RTO 1h, "como conferir", reconstrução do zero e a seção de monitor.

**Migration:** nenhuma.

**Testes:**
- vitest `lib/db`: DATABASE_URL numa porta fechada faz a 1ª chamada rejeitar; trocar a URL faz a 2ª funcionar.
- vitest `parseId`: '2147483648', '1e21', '01', ' 1' e '7'.
- vitest `blog`: `[x](/\evil.com)` não pode virar href.
- vitest `seo`: robots com disallow quando o SITE_URL não é o de prod.
- vitest `currentMember`: 2 chamadas no mesmo request fazem só 1 `currentUser`, e nenhuma quando o membro já existe.
- e2e: `/x.png` com 404 ou tela PT-BR, nunca a tela em inglês; `/p/2147483648` com 404.
- Shell: `bash -n` em todos os .sh; `shellcheck` se tiver.

**Pronto quando:**
- `npm audit --omit=dev --audit-level=high` sai limpo.
- O gate do AGENTS.md passa (lint, typecheck, build, vitest, e2e).
- O release com standalone tem < 300 MB e não tem `pglite*.wasm` em `.next/static/media`.
- `/api/health` mostra `version`.
- No stage, 100 requests de scanner não geram stack sem rota no journal.
- O commit do CVE está em prod no mesmo dia (deploy feito pelo Jazz).

---

### Pacote B: edição, datas, RSVP, check-in e painel do organizador

**Objetivo:** datas sempre em horário de Brasília, o organizador operando a própria edição sem ser admin global, e nenhuma perda silenciosa de dados ou de vaga.

**Achados:**
- crítico: `fuso-datetime-local-utc` (+ `startsAt-sem-fuso`)
- alto: `create-slug-sobrescreve-edicao` (+ `admin-upsert-hackathon`), `seed-desativa-edicao-admin`, `aprovar-inscricao-fora-do-painel` (+ `curadoria-organizador-vs-staff`), `organizador-nao-edita-edicao`, `rsvp-expira-sem-email`
- médio: `edicao-nasce-publica`, `visao-geral-sem-checklist`, `abas-sem-ordem-de-fase` (+ `admin-abas-alvos-20px`), `checkin-foco-perdido-feedback-fora-tela`, `checkin-reenviar-antes-de-marcar`, `convite-equipe-sem-aviso-e-sem-porta` (notificação no convite), `admin-lista-tudo-misturado` (+ `admin-page-por-edicao`), `jargao-tecnico` (nos arquivos de B), `jurado-revogado-continua-votando` (lado roles.ts)
- baixo: `checkin-sem-janela` (+ `-online`), `rsvp-desligar-overbook`, `pack-offline-status-desatualizado`, `vagas-no-formulario`, `funil-duplicado-inconsistente`, `criar-edicao-campos-faltando`, `estados-vazios` (presença e check-in), `live-regions` (ScheduleEditor e RsvpConfigForm), `eca-digital-menores` (minAge ≥ 18 se o F9 decidir "não")

**Arquivos:**
- `lib/rsvp.ts`: `parseEventStart` trata valor sem offset como America/Sao_Paulo e data pura como 09:00 BRT (parser único exportado). Não expira quem não teve convite `sent` por e-mail ou zap. `setRsvpConfig` recusa `enabled=true` sem `emailDriver` configurado (400) e devolve 409 quando a capacidade efetiva fica < countApproved.
- `lib/hackathons.ts`: `isRegistrationClosed` passa a usar o parser novo. `lib/admin.ts`: normaliza na escrita.
- `app/api/admin/hackathons/route.ts`: `ON CONFLICT DO NOTHING RETURNING` → 409, valida id com `/^[a-z0-9-]{3,80}$/`, valida registrationUrl, normaliza o fuso (POST), cria com `active=0` (rascunho) e `source` preenchido.
- `app/api/admin/hackathons/[id]/route.ts`: guarda `canManageEdition` (active e slug ficam só com o admin), fuso normalizado e 400 pra formato desconhecido.
- `components/EditEventForm.tsx` (converter pra horário de SP em vez do `slice`) e `components/CreateEventForm.tsx` (só slug, nome, datas e local; tirar o campo morto; copy "horário de Brasília"; redirecionar pra `/admin/h/{id}`).
- `lib/seed.ts`: desativar só `source='seed'` fora da lista.
- `app/admin/h/[id]/layout.tsx` + `components/AdminTabs.tsx` (novo, client): abas agrupadas por fase, `aria-current`, alvo ≥ 44px e scroll horizontal no mobile.
- `app/admin/h/[id]/edicao/page.tsx` (novo, aba "configurar" com o EditEventForm, capacidade e "publicar edição").
- `app/admin/h/[id]/page.tsx`: checklist por fase, status da fase, link pra pendentes e funil único.
- `app/admin/h/[id]/inscritos/page.tsx`, `components/RegistrantsTable.tsx`, `components/RegistrationActions.tsx`: aprovar/recusar por linha e filtro por status. `app/api/admin/hackathons/[id]/registrations/[memberId]/route.ts`: `requireEditionManager` e nomes de badge em vez de ids.
- `lib/walkin.ts`: aceitar só `waitlist` e só dentro de `checkinWindow`. `lib/checkins.ts`: `checkinWindow` no `checkIn` online (409, com override do admin registrado). `lib/checkinPack.ts`, `lib/offlineCheckin.ts`: `clamped=true`, idade do pacote e "enfileirar mesmo assim".
- `components/CheckinDesk.tsx`: limpar busca e devolver o foco depois do check-in, feedback perto da busca, "marcar presença" antes de "reenviar", copy "chegou sem inscrição".
- `lib/roles.ts`: revogar jurado apaga as `judge_assignments` do par na mesma transação; convite manda notificação in-app (e e-mail quando houver driver).
- `components/EditionTeamPanel.tsx`, `app/admin/page.tsx` (separar "edições que você organiza" do radar, busca, carregar detalhe só ao abrir), `app/admin/h/[id]/presenca/page.tsx`, `app/admin/h/[id]/checkin/page.tsx`, `components/RsvpConfigForm.tsx`, `components/QuestionEditor.tsx` (tirar dali a capacidade), `components/ScheduleEditor.tsx` (live region), `components/EventTermsEditor.tsx` (minAge, se o F9 decidir).

**Migration `019_event_time_tz.sql`:**
- `CREATE OR REPLACE FUNCTION to_ts` tratando valor sem offset como `America/Sao_Paulo`.
- `UPDATE hackathons SET startsAt = startsAt || '-03:00'` (mesmo pra endsAt e registrationDeadline) onde casar `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$`.
- `UPDATE hackathons SET source='seed'` pros ids do seed, com o seed passando a gravar isso.
- Tudo idempotente.

**Testes:**
- vitest: salvar o form sem mudar nada não altera startsAt.
- vitest: parser com `'2026-11-14T09:00'` dá 12:00Z, e `parseEventStart` e `to_ts` concordam pra valor sem offset, data pura e valor com offset.
- vitest: POST com slug existente dá 409 e a linha original fica intacta.
- vitest: seedDatabase depois de criar edição pelo admin mantém active=1.
- vitest: RSVP sem RESEND com prazo vencido expira 0.
- vitest: revogar jurado apaga as assignments.
- vitest: walk-in em `pending` dá 409 e fora da janela dá 409.
- vitest: organizador não-admin aprova (200) e staff não aprova (403).
- e2e no stage: organizador convidado edita data, aprova pendente e vê a aba ativa marcada; no check-in a 390px, Enter faz o foco voltar pra busca.

**Pronto quando:**
- No stage, editar a Alphaville mantém "lembrete H-2 07:00".
- Um organizador sem admin global cria, configura, publica e aprova sozinho.
- O gate do AGENTS.md passa.

---

### Pacote C: inscrição, time e entrega (jornada do participante)

**Objetivo:** inscrição e cancelamento com regra, time que se resolve sem mexer no banco, participante sempre avisado do status e entrega sem caminho escondido.

**Achados:**
- crítico: `time-membro-fantasma-bloqueia-entrega`
- alto: `unregister-sem-regra` (+ `rejeitado-reabre-pedido`, `xp-farm-cancelar-reinscrever`), `inscricao-edicao-encerrada` (+ `register-edicao-encerrada`, `deadline-nao-fecha-inscricao`, `inscricao-apos-encerrada`), `board-expoe-contato-e-nao-desativa`, `reprovacao-sem-aviso` (+ `curadoria-sem-resposta`), `cancelar-inscricao-sem-confirmacao`
- médio: `privacidade-pos-evento`, `ingresso-fila-diz-nao-inscrito` (+ `ingresso-waitlist-nao-inscrito`), `duvidas-bloqueia-fila`, `convite-time-ignorados-sem-motivo`, `projeto-dois-editores`, `dieta-sem-edicao-posterior`, `registerbutton-falha-silenciosa`, `badge-id-cru` (nas rotas e componentes de C), `status-aprovado-sem-proximo-passo` (parte /inscricao), `n1-listEntriesForAdmin`, `n1-getArchive-memberTeamFor`, `form-erro-nao-anunciado` (RegistrationForm)
- baixo: `time-duplo-race`, `submit-version-race`, `entrega-perde-texto-sem-titulo`, `entrega-confirm-antes-de-validar`, `exclusao-conta-copy-inexata`, `form-inscricao-erro-nao-limpa`, `n1-projetos-deploy-por-card`, `inscreve-te-primeiro-api`, `copy-tu-voce` (nos arquivos de C), `jargao-tecnico` (banner de entregas)

**Arquivos:**
- `lib/registrations.ts`:
  - `unregister` recusa com o evento começado, com check-in ou com status `rejected`, e não promove fila depois do início.
  - Ao sair, remove a pessoa de `team_members` e de `team_invites`, desativa o board e avisa o time.
  - `completeRegistration` paga a recompensa uma vez só por (membro, edição).
  - `reviewRegistration` chama `notify()` na aprovação e na recusa e também remove do time em caso de recusa.
  - Copy da linha 99.
- `lib/registrationForm.ts`: em `submitRegistration`, 409 quando `isRegistrationClosed(h)` ou a edição já acabou (importar de `lib/hackathons`/`lib/rsvp`, que são de B), e 404 quando não é partner.
- `app/api/hackathons/[id]/register/route.ts`: DELETE com a regra nova, PATCH de dieta e alergia (nova versão em registration_terms) e nomes de badge.
- `lib/teams.ts`: `memberTeamFor` com 2 queries, advisory lock em `submitTeam` e PATCH `leave`/`remove`. `lib/teamInvites.ts`: advisory lock no aceite, `ignored` com motivo, desativar o board no aceite e copy em "você". `lib/teamboard.ts`: `note` e `memberId` fora do payload anônimo, POST barrado em edição encerrada e erros em PT-BR.
- `app/api/hackathons/[id]/team/route.ts`, `app/api/hackathons/[id]/team-board/route.ts`, `app/api/posts/route.ts` (o "inscreve-te primeiro" vira "só quem tem inscrição aprovada…").
- `lib/archive.ts`: JOIN + `ANY` (N+1). `lib/projects.ts`: LATERAL do último deploy e paginação.
- `lib/entries.ts`: N+1 do `listEntriesForAdmin`, `FOR UPDATE` no time / retry no 23505 e texto "Fulano saiu — remova em Meu time". `components/EntryEditor.tsx`: `beforeunload`, dica do título, botão desabilitado com `missing` e erro num lugar só. `app/admin/h/[id]/entregas/page.tsx` e `components/EntriesAdmin.tsx`: banner neutro e copy sem "modo antigo".
- `components/MyTeamPanel.tsx`: sair do time, remover integrante, motivo dos ignorados, placeholder `@joao_dev`, "criar time" e link fixo "abrir entrega" no lugar do form duplicado.
- `components/TeamBoardPanel.tsx`: rótulo sem "contato" e nada de telefone pra menor.
- `components/RegisterButton.tsx`: status separado da ação, `confirm` ao cancelar, `else` de erro (404/429/5xx), nomes de badge e "você".
- `components/RegistrationForm.tsx`: validar tudo de uma vez, limpar o erro no onChange, `aria-describedby`/`aria-required`, foco no campo com erro e `sr-only "(obrigatória)"`. `components/EventTermsFields.tsx`: copy do e-mail ao responsável condicionada a `emailDriver`.
- `app/h/[id]/inscricao/page.tsx` (próximos passos e editar dieta), `app/h/[id]/ingresso/page.tsx` (ramo waitlist com posição), `app/h/[id]/entrega/page.tsx`, `app/h/[id]/duvidas/page.tsx`, `lib/questions.ts` (waitlist entra e copy em "você").
- `lib/privacy.ts`: `future` via `parseEventStart`, sai dos times da edição futura, mantém `scores`, `live_votes`, `nps_responses` e `certificates` anonimizados (apaga só texto livre). `components/PrivacyPanel.tsx`: copy exata do que acontece e "você".

**Migration `020_registration_rewards.sql`:** tabela `registration_rewards (memberId, hackathonId, rewardedAt, PRIMARY KEY(memberId, hackathonId))`, sem FK pra registrations (sobrevive ao DELETE), mais backfill a partir de `member_cards`.

**Testes (vitest PGlite):**
- submit → unregister → submit ×4 deixa xp = 50.
- reject → unregister dá 409.
- check-in → unregister dá 409.
- unregister depois de startsAt dá 409 e ninguém é promovido.
- unregister de integrante faz `submitEntry` do time passar.
- `deleteMemberData` mantém as notas (ranking igual) e remove a pessoa do time.
- register em edição encerrada ou com deadline vencido dá 409.
- GET anônimo do board não traz `note` nem `memberId`.
- aceite do convite desativa o board.
- reject gera notificação.
- e2e: cancelar pede confirmação; pessoa na fila vê "fila de espera #N" em /ingresso.

**Pronto quando:**
- No stage, o cenário Carla/Davi da auditoria deixa a Ana enviar a entrega.
- Nenhum POST de inscrição em edição passada é aceito.
- O gate do AGENTS.md passa.

---

### Pacote D: júri, palco, certificados e pós-evento

**Objetivo:** resultado justo e congelado, documentos coerentes com o pódio e o participante avisado do fim da jornada.

**Achados:**
- alto: `juri-nota-parcial-vence`, `silencio-resultado-feedback-certificado`
- médio: `jurado-revogado-continua-votando` (lado jury), `juri-ranking-muda-pos-publicacao`, `voto-publico-media-sem-minimo`, `cert-premiacao-sem-revogar`, `carga-horaria-33h-todos`, `juri-radiogroup-teclado` (inclui o status preso em "saving"), `stagevote-radio-sem-setas`
- baixo: `sse-palco-sem-limite`, `sse-palco-duplicado-e-sem-coalescer`, `publicar-resultado-sem-motivo`, `live-regions` (StageVote, NpsForm, NpsCloseForm), `copy-tu-voce` (StageVote, feedback e júri), `jargao` (StageControl "FILA.exe", "toca")

**Arquivos:**
- `lib/jury.ts`:
  - `computeRanking` marca "incompleto" quando falta nota de jurado atribuído.
  - `saveScores` exige `isJudge`.
  - `rankingInputs` só conta notas de jurado com papel e atribuição vigentes.
  - `updateCriterion`/`removeCriterion` devolvem 409 depois de publicado.
  - `publishResults` devolve 409 com `missing > 0`, a menos que venha `force` com motivo, e grava o snapshot. A leitura pós-publicação vem do snapshot.
- `lib/juryHttp.ts`, `app/api/admin/hackathons/[id]/juri/**` (publish com force e motivo, feedback com notify), `components/JuryOrganizer.tsx` (motivo do botão desabilitado e contagem de notas faltando no confirm), `components/JudgeScoreForm.tsx` (radios nativos, h-11, try/finally, `role=status` sempre montado), `app/admin/h/[id]/juri/page.tsx`.
- `lib/juryFeedback.ts`: notificar os integrantes ao liberar. `app/p/[teamId]/feedback/page.tsx`: copy em "você".
- `lib/certificates.ts`: revogar `premiacao` que saiu de grants, nunca reescrever `detail` (emitir novo e revogar o antigo) e notificar cada código novo. `app/c/[code]/page.tsx`: mostrar "revogado". `app/admin/hackathons/[id]/certificados/route.ts` (o caminho real é `app/api/admin/hackathons/[id]/certificados/route.ts`), `app/admin/h/[id]/certificados/page.tsx`, `components/CertificateSettingsForm.tsx`, `lib/certHours.ts`: só o participante herda a duração da edição por padrão; staff, mentor e jurado são obrigatórios antes de emitir.
- `lib/stage.ts`: média bayesiana ou mínimo de votos por time e selo "poucos votos". `lib/stageStream.ts` + `app/api/hackathons/[id]/stage/stream/route.ts`: limite por IP (~5) e global (~2000) com 429, `lastKey` inicializado, usar `ch.last` ao conectar, coalescer em 500–1000 ms e checar `aborted` depois do listener. `components/StageVote.tsx` (radios nativos, h1, live region fixa e anúncio da troca de pitch), `components/StageControl.tsx` (copy e motivo do disabled).
- `components/NpsForm.tsx`, `components/NpsCloseForm.tsx`: live region sempre montada.

**Migration `021_jury_results_cert_revoke.sql`:** `certificates.revokedAt TEXT NULL`, tabela `jury_results (hackathonId PK, publishedAt, publishedBy, ranking JSONB, forced BOOLEAN, reason TEXT)`.

**Testes (vitest):**
- time A com 1 nota não fica à frente de B completo.
- publish com missing > 0 dá 409 e com force dá 200, com o motivo gravado.
- jurado revogado no POST de scores dá 403 e as notas dele saem do ranking.
- removeCriterion depois de publicar dá 409.
- republicar sem o time X deixa o certificado dele revogado.
- emitir certificado gera 1 notificação por código.
- liveRanking: 1 voto 5 fica atrás de 9 votos de média 4,8.
- SSE: a 6ª conexão do mesmo IP leva 429; primeiro ouvinte recebe 1 snapshot, não 2.
- e2e/axe: /h/[id]/votar e /admin/h/[id]/juri sem violações serious, e setas mudam o radio.

**Pronto quando:** no stage, publicar com avaliação incompleta é recusado e mostra quantas notas faltam, o pódio publicado não muda ao editar critério e o gate do AGENTS.md passa.

---

### Pacote E: comunicação, copy, LGPD, a11y e superfícies públicas

**Objetivo:** a interface só promete o que o sistema faz, tom único em "você", política de privacidade fiel ao produto, opt-ins revogáveis, contraste AA e páginas públicas sem número vexatório.

**Achados:**
- alto: `email-prometido-sem-driver` (+ `email-zap-prometido-sem-driver-prod`, `entregas-skipped-silencioso`), `privacidade-incompleta` (+ `lgpd-politica-incompleta`, parte de código), `empresas-stats-zero`
- médio: `subscribe-sem-limite-consentimento` (+ `subscribe-sem-ratelimit-csv`), `incidente-anonimo-nat`, `optin-patrocinador-sem-lista`, `tu-voce-misturado` (arquivos órfãos), `erros-api-crus-ui` (helper + componentes de E), `radar-tags-cruas-ingles`, `email-responsavel-reply-placeholder` (copy), `contraste-accent-orange-chrome-tinta`, `link-in-text-sem-sublinhado`, `perfil-h1-overflow`, `badge-id-cru` (HackathonCard e members/me), `form-erro-nao-anunciado` (IncidentForm)
- baixo: `avisos-admin-pulado-sem-motivo`, `aviso-zero-destinatarios`, `sem-grupo-contra-ferramenta`, `email-aviso-descadastro-cancela-inscricao`, `ticket-email-online-default`, `rsvp-o-que-levar-hardcoded`, `open-to-ingles`, `estados-vazios` (notificações, patrocinador, talento), `jargao` (membros "leaderboard", CalendarFeedLink), `tu-com-verbo-3a-pessoa`, `alvos-pequenos-publico`, `live-regions` (EditionSponsorsAdmin, AnnouncementComposer), `announcements-fanout-row-by-row`, `termos-plataforma-sem-aceite` (versão numerada nas páginas)

**Arquivos:**
- `lib/notify/channels.ts` (novo, `channelsEnabled()`), `lib/notify/email.ts` (reply-to), `lib/notify/templates.ts` (rodapé), `lib/notify/types.ts` (motivo `no_driver`).
- `lib/announcements.ts`: INSERT em lote com `unnest`; reenfileirar `no_driver` quando o driver passar a existir.
- `lib/ticketEmail.ts` (local "a confirmar"), `lib/rsvpMessages.ts` (você e o-que-levar), `lib/eventTerms.ts` (só a copy do e-mail ao responsável).
- `app/admin/h/[id]/avisos/page.tsx` (faixa "e-mail desligado", motivo agrupado, sem "Sem grupo.", "sino"), `components/AnnouncementComposer.tsx` (contagem no confirm, 0 bloqueia, só canais ativos), `components/EditionAnnouncements.tsx`, `components/ProfileForm.tsx` (copy condicionada aos canais, "disponível para", "você").
- `app/perfil/page.tsx` (h1 com break-words, seção "Contato com marcas" com revogar), `app/u/[username]/page.tsx`, `lib/sponsorContacts.ts` (listar opt-ins do membro).
- `app/legal/privacidade/page.tsx` (operadores com país, telefone/WhatsApp, opt-in com patrocinador, transferência internacional, retenção, versão; controlador e encarregado entram depois do F8; contato vira mailto em vez de /empresas), `app/legal/termos/page.tsx` (versão numerada).
- `app/api/subscribe/route.ts` (`limitOrNull`, consentimento, limite de 254 caracteres), `app/api/subscribe/unsubscribe/route.ts` (novo), `app/api/admin/subscribers/route.ts` (`csvField` com prefixo `'`), `lib/ratelimit.ts` (subscribe 5/h; incidents anônimo por IP + edição 20/h), `app/api/hackathons/[id]/incidents/route.ts` (chave por edição e tamanho mínimo), `components/IncidentForm.tsx` (aria-required e copy).
- `lib/apiError.ts` (novo, `userMessage(res,data,fallback)`), aplicado em `SponsorForm`, `ChallengeForm`, `QuestionThread`, `LeadForm`, `SubmitEventForm`, `FeedSection`. `lib/challenges.ts` e `lib/sponsors.ts`: mensagens em PT-BR.
- Copy em "você" nos órfãos: `CalendarFeedLink.tsx`, `AttendanceHistory.tsx`, `QuestionThread.tsx`, `lib/roleApplications.ts`, `app/api/posts/[id]/comments/route.ts`, `app/api/posts/[id]/like/route.ts`, `app/talento/page.tsx`, `app/membros/page.tsx`, `app/notificacoes/page.tsx`, `components/SponsorReportView.tsx`.
- `app/empresas/page.tsx`: contar só edições internas, membros sem `deleted:%` e piso mínimo antes de mostrar.
- `components/HackathonFeed.tsx`, `app/radar/page.tsx`, `scripts/scrape_radar.py`: descartar `premio-*` e tokens soltos, dicionário PT-BR.
- `components/HackathonCard.tsx` (nome da badge e "pedido enviado…"), `app/api/members/me/route.ts` (nome da badge e erros em PT-BR), `lib/openTo.ts` (rótulo "emprego").
- `app/globals.css`: tokens `--accent-on-chrome`/`--orange-on-chrome` e `.link-inline`. **Avisar a frente P**, que pode estar mexendo nesse arquivo; combinar antes ou fazer append no fim. `app/feed/page.tsx`, `components/EditionSponsorsAdmin.tsx`, `app/empresas/page.tsx` e as próprias páginas legais usam os tokens e `.link-inline`. `components/ShareBar.tsx`: min-h-11, `role=group`, "X (Twitter)". `app/h/[id]/projetos/page.tsx`: chips com py-3.

**Migration `022_subscribers_consent.sql`:** `subscribers` ganha `consentAt`, `policyVersion`, `confirmedAt`, `confirmToken` e `unsubscribeToken`; `deliveries` ganha `reason TEXT NULL` (pro `no_driver`).

**Testes:**
- vitest: o 6º POST de subscribe na mesma hora leva 429.
- vitest: CSV com `=HYPERLINK(...)@a.co` sai com prefixo `'`.
- vitest: 10 incidentes anônimos do mesmo IP dão 10 × 201.
- vitest: `channelsEnabled()` sem env fica com email e whatsapp false, e o composer mostra só "página e sino".
- vitest: reenfileirar `no_driver` depois de pôr a chave.
- e2e/axe em /feed, /empresas, /legal/*, /perfil (username de 20 caracteres a 390px, scrollWidth ≤ 390) e /talento sem `color-contrast` ou `link-in-text-block`.
- `grep -rnE "\b(tu|teu|tua|tens|inscreve-te)\b"` nos arquivos de E retorna 0.

**Pronto quando:**
- Com o env de prod atual, nenhuma tela promete e-mail.
- /empresas não mostra "membros 0".
- A privacidade lista os operadores e o compartilhamento com patrocinador.
- O gate do AGENTS.md passa.

---

## 4. Onda 2 (sequencial, depois do merge de A–E)

Esses itens cruzam arquivos de vários pacotes ou dependem de ação do fundador:

1. **`sem-audit-trail`** (médio): migration `023_audit_events.sql`, `lib/audit.ts` e chamadas em roles, applications, registrations PATCH e export, juri/publish, certificados/csv e members/me DELETE e export, mais uma aba simples. `REVOKE UPDATE, DELETE` do role da app só funciona depois do F4.
2. **Varredura final de copy:** grep de "tu/teu/tens" e de `data?.error ??` no repo todo, aplicando `lib/apiError.ts` nos componentes que sobraram.
3. **`parseId`** nos ~44 usos que sobraram de `Number.isInteger` em app/api.
4. **`.link-inline`** nas ocorrências restantes de texto corrido (cerca de 40 no total).
5. **ECA** (se o F9 decidir aceitar menor): confirmação ativa do responsável e perfil de menor fora de /talento e /membros.
6. **Aceite de termos da plataforma:** copiar `legal_accepted_at` do Clerk pra `members.termsAcceptedAt/termsVersion` (depende do F10).
7. **CI de verdade:** ligar o workflow do pacote A no repo privado (F3) e passar o deploy a baixar o artefato pronto em vez de buildar.

## 5. Notas para quem executa

- **Deploy é só do Jazz.** Agentes não fazem build nem mexem em cron, serviço, Caddy ou env na VPS. O build roda no notebook ou na CI, e o release vai pronto.
- **Antes de tudo:** F1 + F2 + o commit do CVE do pacote A. Sem e-mail configurado, não dá pra ligar o RSVP em edição nenhuma, e o pacote B passa a recusar isso no código.
- **Conflitos esperados:** B e C não editam o mesmo arquivo; C só importa `parseEventStart`/`isRegistrationClosed` de B (por isso B entra antes). `app/globals.css` (pacote E) e os ícones em `app/` (pacote A) precisam ser combinados com a frente P.