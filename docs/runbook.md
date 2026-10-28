# Runbook — HackaHub em produção

Tudo roda na VPS **asyn-oracle** (`ssh ubuntu@64.181.217.112`, OCI
us-chicago-1), que também hospeda asyn-settlement, cachorro, oneiro e
pocketful. Regra de convivência: o HackaHub só mexe no que é dele (tabela
abaixo). Nada de reiniciar Caddy inteiro: só `systemctl reload caddy` depois
de `caddy validate`.

## O que é do HackaHub na máquina

| Peça | Onde |
|---|---|
| App stage | systemd `hackahub-stage` → `:3410`, `~/hackahub/stage/current` |
| App prod | systemd `hackahub-prod` → `:3411`, `~/hackahub/prod/current` |
| Postgres | container `hackahub-pg` (postgres:17-alpine, `127.0.0.1:5434`, 1 GB, volume `hackahub-pgdata`); bancos `hackahub` (prod), `hackahub_stage`, `hackahub_e2e*`, `hackahub_dev` |
| Caddy | blocos marcados `# hackahub-stage` / `# hackahub-prod` no fim de `/etc/caddy/Caddyfile` |
| Segredos | `~/hackahub-secrets/` (700): `pg.env`, `url.<banco>`, `stage.env`, `prod.env`, `backup-par.url`, estado do Clerk dev |
| Ops | `~/hackahub/ops/`: cópia de `deploy/` do repo, atualizada a cada deploy (`deploy.sh`, `backup.sh`, `restore-drill.sh`, `cron-call.sh`, `scrape.sh`, `wait-pg.sh`, `crontab.txt`…). Logs em `~/hackahub/logs/` |
| Backups | `~/hackahub-backups/<stamp>/` (14 dias) + bucket OCI `hackahub-backups` (prefixo `hackahub/`, expira em 60 dias) |
| Scraper | venv `~/hackahub/scraper/.venv` (uv) |
| Cron (usuário ubuntu) | fonte da verdade: `deploy/crontab.txt` (seção Cron abaixo) |

Portas de app não são públicas: security list da OCI só abre 22/80/443 e o
iptables rejeita o resto (verificado de fora em 14/10/2026).

## Deploy

Primeira vez numa máquina (ou se `~/hackahub/tmp` sumiu):

```bash
ssh ubuntu@64.181.217.112 'mkdir -p ~/hackahub/tmp ~/hackahub/ops ~/hackahub/logs'
```

Cada deploy:

```bash
# no notebook, a partir de um commit limpo
git archive --format=tar.gz -o /tmp/hh.tar.gz HEAD
scp /tmp/hh.tar.gz ubuntu@64.181.217.112:~/hackahub/tmp/hh-release.tar.gz
# roda o deploy.sh que está DENTRO do tarball, não o de ~/hackahub/ops: a
# cópia em ops é a do deploy anterior e pode ser mais velha que o release
ssh ubuntu@64.181.217.112 'cd ~/hackahub/tmp && tar -xzf hh-release.tar.gz deploy && bash deploy/deploy.sh stage ~/hackahub/tmp/hh-release.tar.gz'
# conferiu no stage → mesmo tarball pra prod (o deploy de prod apaga o tarball no fim)
ssh ubuntu@64.181.217.112 'cd ~/hackahub/tmp && tar -xzf hh-release.tar.gz deploy && bash deploy/deploy.sh prod ~/hackahub/tmp/hh-release.tar.gz'
```

O tarball fica em `~/hackahub/tmp`, nunca em `~/hackahub-secrets`.

`deploy.sh`:

1. Aborta se o disco tiver menos de 2 GB livres.
2. Faz `npm ci` + `next build` numa pasta temporária, com o env do ambiente.
3. Monta o release com `assemble-release.sh`: só a saída standalone do Next
   (`server.js` e o `node_modules` que o servidor usa), `.next/static` e as
   pastas lidas em runtime (`migrations`, `content`, `assets`, `scripts`,
   `deploy`). Fica perto de 150 MB, contra 1,1 GB antes.
4. Grava `VERSION` (commit + data), que o `/api/health` mostra.
5. Atualiza `~/hackahub/ops` com os scripts de `deploy/` e reescreve a unit
   do systemd (hardening, `wait-pg.sh` antes de subir).
6. **Em prod, roda o `backup.sh` antes de trocar o release.** Se o backup
   falhar, o deploy para ali.
7. Troca o symlink `current`, reinicia o serviço e espera `/api/health`
   (app + banco) por até 40 s.
8. Roda o `smoke.sh`: home, páginas públicas, sitemap, imagem de
   compartilhamento, uma edição (`/h/<id>` e a imagem dela), um time (`/p/<id>`) e o PDF de um
   certificado, com ids tirados do banco do ambiente. Depois procura
   `EROFS`, `ENOENT` e `EACCES` no journal desde o restart. O health só
   testa o banco; o smoke pega arquivo que o standalone deixou de fora e
   escrita barrada pelo sandbox da unit.
9. Se o health ou o smoke falharem, **volta sozinho** pro release anterior.
10. Mantém os **2** últimos releases por ambiente.

Migrations rodam no boot do app (em ordem, com lock). Hoje são 18 (`ls
migrations | wc -l`). Deploy de migration destrutiva precisa de plano
expand/contract, e ainda não existe nenhuma.

Pra testar o modo standalone antes de subir (o e2e roda `next start`, não
`server.js`): `next build` e depois `bash deploy/standalone-smoke.sh <porta>
[banco]`, com o env do app carregado. Ele monta o release igual ao deploy,
sobe `node server.js` e roda o mesmo `smoke.sh`.

Como conferir:

```bash
curl -s https://hackahub.jazzautomations.com.br/api/health      # {"ok":true,"version":"<commit> <data>"}
ls -1dt ~/hackahub/*/releases/*                                  # 2 por ambiente
systemctl cat hackahub-prod | grep -E 'NoNewPrivileges|ExecStartPre'
```

### Rollback manual

```bash
ls -1dt ~/hackahub/prod/releases/*        # escolhe o anterior
ln -sfn ~/hackahub/prod/releases/<stamp> ~/hackahub/prod/current
sudo systemctl restart hackahub-prod
```

Rollback de código não desfaz migration: se a versão nova aplicou migration
incompatível com a antiga, restaurar backup (abaixo).

## Backup e restauração

- `ops/backup.sh`: `pg_dump -Fc` de `hackahub` e `hackahub_stage`, SHA256,
  cópia offsite por link pré-autenticado **só de escrita** (a VPS não lê nem
  apaga o bucket), rotação local de 14 dias, carimbo em
  `~/hackahub-backups/LAST_OK`.
- `ops/restore-drill.sh [dir] [banco]`: confere checksum, restaura num banco
  descartável, conta as linhas de **todas** as tabelas, compara com a origem
  (só leitura) e apaga. No sucesso grava `~/hackahub-backups/LAST_DRILL_OK-<banco>`.
  Roda no cron: prod no domingo, stage na quarta. O `/api/health?deep=1` e o
  monitor olham só o carimbo de prod (`LAST_DRILL_OK-hackahub`), então um
  drill de stage que passa não esconde um drill de prod que falha.
- Segredos no backup (opcional): com `age` instalado e a chave pública em
  `~/hackahub-secrets/backup-age.pub`, o `backup.sh` cifra `prod.env`,
  `stage.env`, `pg.env` e `backup-par.url` em `secrets.tar.age` e manda junto
  pro bucket. A chave privada fica só com o Jazz, fora da VPS.

**RPO 24 h / RTO 1 h.** O backup é diário (06:00 UTC) e não há arquivamento
contínuo do Postgres (`archive_mode=off`), então dá pra perder até um dia.
Perto de edição ao vivo, descomente a linha de backup de hora em hora no
`deploy/crontab.txt` e reinstale o cron. O RTO de 1 h é o procedimento
"Restaurar de verdade" abaixo, com o dump local.
- O link de escrita expira em **14/10/2027** — renovar antes
  (`oci os preauth-request create --bucket-name hackahub-backups --access-type AnyObjectWrite ...`).

Restaurar de verdade (incidente):

```bash
sudo systemctl stop hackahub-prod
docker exec hackahub-pg dropdb -U hackahub hackahub --force
docker exec hackahub-pg createdb -U hackahub hackahub
docker exec -i hackahub-pg pg_restore -U hackahub -d hackahub --no-owner < ~/hackahub-backups/<stamp>/hackahub.dump
sudo systemctl start hackahub-prod
```

Backup que só está no bucket: baixar pelo console da OCI ou
`oci os object get --bucket-name hackahub-backups --name hackahub/<stamp>/hackahub.dump --file x.dump`
(no notebook do Jazz, que tem credencial de leitura).

### Registro de restore drills

| Data | Backup | Banco | Resultado |
|---|---|---|---|
| 2026-10-14 | 20261014T031838Z | hackahub_stage | ok — contagens iguais à origem (hackathons=4, migrations=1), checksum ok, offsite conferido no bucket |

O registro acima é do stage antes das migrations 002–018 e o drill da época contava só 5 tabelas. A partir de agora o `drill.log` traz a contagem de todas as tabelas.

## Cron

Fonte da verdade: `deploy/crontab.txt`, instalado com
`crontab ~/hackahub/ops/crontab.txt` (substitui o crontab do ubuntu; guarde
o anterior com `crontab -l > ~/hackahub/tmp/crontab.antes` e junte linhas de
outros produtos, se houver).

| Quando (UTC) | Script | Rota |
|---|---|---|
| 06:00 diário | `backup.sh` | — |
| dom 06:30 / qua 06:30 | `restore-drill.sh` prod / stage | — |
| 05:15 / 05:20 | `scrape.sh` stage / prod | — |
| a cada 2 min | `deliveries.sh` | `/api/cron/deliveries` (fila de avisos por e-mail/zap + pesquisa pós-edição) |
| a cada 5 min | `submissions.sh` | `/api/cron/submissions` (lembretes e trava da entrega) |
| a cada 15 min | `rsvp.sh` | `/api/cron/rsvp` |
| a cada 10 min | `disk-guard.sh` | — |

As rotas `/api/cron/*` passam pelo `cron-call.sh`, que grava uma linha por
chamada em `~/hackahub/logs/<rota>-<env>.log` (horário, código HTTP,
duração e o começo do corpo quando falha) e o contador de falhas seguidas
em `logs/.fail-<rota>-<env>`. O `backup.sh` corta log acima de 5 MB.

Como conferir: `crontab -l | grep hackahub` e `tail ~/hackahub/logs/deliveries-prod.log`.

Stage também roda avisos, entregas e RSVP. Era assim no crontab instalado
em 14/10/2026 e continua: é no stage que se testa o fluxo inteiro antes de
prod. Por isso o stage manda e-mail de verdade (o `stage.env` tem
`RESEND_API_KEY`) e não manda zap (sem `EVOLUTION_*`). Quem recebe são as
contas criadas no stage. O banco `hackahub_stage` nunca recebe cópia do de
prod: o restore drill restaura num banco temporário e apaga no fim. Se um
dia o stage for receber dados de prod, tire antes as três linhas de stage do
`crontab.txt` ou apague `RESEND_API_KEY` do `stage.env`.

## Monitor e alerta

- `/api/health` responde `ok` e `version`. `?deep=1` soma `backupAgeH`,
  `drillAgeH`, `oldestQueuedDeliveryMin`, `oldestQueuedTicketMin`,
  `diskPct` e `cronFails`.
- O monitor roda fora da VPS, no imac-server (`deploy/monitor/`, instalação
  no README de lá). A cada 2 min ele lê o `?deep=1` e manda zap pelo
  Evolution quando o site cai, o backup passa de 26 h, o drill passa de 8
  dias, a fila para por mais de 15 min, o disco chega a 85% ou um cron falha
  3 vezes seguidas.
- Erro de servidor sai no journal como uma linha JSON com rota e digest. O
  digest é o "código de referência" que a tela de erro mostra:
  `journalctl -u hackahub-prod -o cat | grep request_error | jq`.
- Query acima de 500 ms aparece em `docker logs hackahub-pg` (o `pg-up.sh`
  liga `log_min_duration_statement`).

## Admins

`HACKAHUB_ADMIN_EMAILS` só **promove**: quem entra na lista vira admin no
próximo acesso. Tirar alguém da lista não rebaixa, porque admin também é dado
por SQL. Revogar é manual:

```bash
docker exec hackahub-pg psql -U hackahub -d hackahub -c "UPDATE members SET role = 'member' WHERE email = '<email>'"
```

## Roles do Postgres

Desde 27/10/2026 prod e stage usam `hh_prod` e `hh_stage` (sem
superusuário); o scraper usa `url.hh_<env>`. Backup, drill, smoke e
manutenção seguem com o superusuário `hackahub` via `docker exec`. Pra
reaplicar (idempotente, `deploy/pg-roles.sql`):

```bash
bash ~/hackahub/ops/pg-roles.sh       # cria hh_prod/hh_stage/hh_dev e grava url.hh_<env> (não imprime)
# trocar DATABASE_URL de prod.env/stage.env pelo conteúdo de url.hh_prod / url.hh_stage
sudo systemctl restart hackahub-stage && curl -s 127.0.0.1:3410/api/health
sudo systemctl restart hackahub-prod && curl -s 127.0.0.1:3411/api/health
```

Teste do isolamento: com o usuário de stage, conectar no banco `hackahub` tem
que falhar com `permission denied for database`. O `hackahub` continua
existindo pro backup e pra manutenção.

## Reconstrução do zero (VPS perdida)

1. VM nova com Docker, Caddy, Node 22, git e `age`. Usuário `ubuntu`.
2. Recuperar `prod.env`, `stage.env`, `pg.env` e `backup-par.url` do
   gerenciador de senhas ou do `secrets.tar.age` do bucket
   (`age -d -i <chave-privada> secrets.tar.age | tar -x -C ~/hackahub-secrets`).
   A chave privada do age NÃO fica na VPS: está no notebook do dono
   (`~/.config/hackahub/backup-age.key`) e no imac-server
   (`~/hackahub-keys/backup-age.key`). Na VPS só a pública
   (`~/hackahub-secrets/backup-age.pub`).
   O `HACKAHUB_TICKET_SECRET` precisa ser o mesmo, senão os QRs emitidos
   param de valer.
3. `bash deploy/pg-up.sh` sobe o container e cria os bancos.
4. Baixar o último `hackahub.dump` do bucket e restaurar (seção acima).
5. `deploy.sh stage` e `deploy.sh prod` com um tarball do commit atual. O
   deploy recria a unit do systemd e o bloco do Caddy.
6. `crontab ~/hackahub/ops/crontab.txt`.
7. DNS: A `hackahub` → IP novo (Vercel DNS).

## Disco (VPS compartilhada)

Incidente 14/10/2026 04:33 UTC: builds paralelas de várias worktrees de
desenvolvimento encheram o disco (100%), o `hackahub-pg` caiu
(`No space left on device`) e prod/stage do HackaHub ficaram fora por ~10 min.
Outros serviços não registraram erro. Recuperação: apagar pastas de
desenvolvimento já mergeadas + `npm cache clean`, `docker restart hackahub-pg`,
reiniciar `hackahub-prod`/`hackahub-stage`. Dados íntegros.

Prevenção: `ops/disk-guard.sh` no cron (10 min) registra alerta a partir de
85% (o monitor externo vê o mesmo número no `diskPct`) e limpa sobras do
HackaHub a partir de 90%: releases fora de uso, build de dev/e2e, o cache npm
próprio do HackaHub e tarballs de release antigos. Nunca limpa o `~/.npm`,
que os outros produtos usam. O deploy aborta com menos de 2 GB livres e
mantém 2 releases enxutos; pasta de desenvolvimento sem `node_modules`
depois de mergeada; nunca mais de 3 builds simultâneas.

## Radar (scraper)

`ops/scrape.sh <stage|prod>` roda `scripts/scrape_radar.py` do release
atual contra o banco do ambiente. Testes: `pytest scripts/test_scrape_radar.py`
(fixtures reais em `scripts/fixtures/radar`; os de banco usam um schema
descartável no `DATABASE_URL` e apagam no fim). Pra rodar à mão, use o
banco `hackahub_dev`, nunca prod nem stage.

O radar é do Brasil e do mundo, e só lista hackathon. Cada evento diz
formato, alcance, se brasileiro pode participar (com o trecho da regra),
prêmio e prazos.

**Fontes** (status em 15/10/2026, abertos depois do filtro)

| fonte | como lê | status |
|---|---|---|
| Sympla | busca pública (`/eventos?s=`) via Jina: hackathon, hackaton, game jam, datathon, ideathon, space apps; robots `Allow: /` | ok, ~20 BR |
| Doity | busca HTML do servidor + JSON-LD da página do evento | ok, 1 BR |
| Shawee | página de inscrições abertas; avisa no log quando abrir | ok, 0 |
| Meetup | Jina, 3 cidades | ok, quase sempre 0 depois do filtro |
| Luma | API pública do discover (`api.lu.ma/discover/get-paginated-events?query=`), por termo no mundo, por termo em SP e RJ e calendários de comunidade (`/calendar/get-items`, lista em `LUMA_CALENDARS`) | ok, ~150 (5 BR). O 0 antigo era o Jina: a página é JS e o Jina via geobloqueio. A API responde do Brasil |
| Devpost | API pública `/api/hackathons?status[]=open` e `upcoming`, todas as páginas (40 por página), + a página de cada hackathon pra ler "Who can participate" | ok, ~107 de ~150 |
| TAIKAI | GraphQL; datas pelas etapas (`steps`) | ok, ~5 |
| ETHGlobal | payload do Next em `/events` (tipo, formato, datas, prazo, cidade) | ok, 1 (Mumbai) |
| MLH | JSON da página da temporada em www.mlh.com (`data-page`) | ok, ~66, quase tudo universidade nos EUA |
| Devfolio | API pública `POST api.devfolio.co/api/search/hackathons` | ok, ~16, quase tudo Índia |
| lablab.ai | payload do Next em `/ai-hackathons` + página de cada um (prêmio) | ok, 2–5 |
| Hack Club | API `hackathons.hackclub.com/api/events/upcoming/` | ok, ~15, ensino médio |
| marcas | página oficial de evento de marca grande (`BRAND_PAGES`, hoje a da Meta) | ok, 1 |
| curadoria | lista à mão no scraper | ok |
| DoraHacks | — | degraded: página e API atrás de captcha AWS WAF |
| HackerEarth | — | degraded: 403 pra robô |
| events.openai.com | — | degraded: 403 (desafio Cloudflare) |
| Kaggle | — | degraded: lista de competições só com login |
| Cerebral Valley | API pública | degraded: só devolve evento de 2024/25 |
| Gupy | — | degraded: sem busca pública; hackathon de banco fica na curadoria |
| Even3, Eventbrite | — | degraded: reCAPTCHA / 405 |

Avaliadas e fora: Unstop (API pública funciona, mas é volume grande de
evento universitário indiano, quase sempre só pra Índia), Colosseum (nenhum
hackathon aberto agora; o próximo abre em abril e entra pela curadoria),
AI Tinkerers (os hackathons de SP são publicados no Luma, que já entra),
itch.io (milhares de game jams pequenas; fica pra quando tiver filtro de
relevância), NASA Space Apps (o site recusa o certificado da VPS; os
eventos locais do Brasil entram pelo Sympla). Instagram, LinkedIn e Google
Forms não dá pra ler: entram pela curadoria ou pela indicação no `/radar`.

**Critério de hackathon** (`classify` no scraper)

1. Termo no nome (ou na descrição, quando a fonte manda): hackathon,
   hackaton, hacka*, hack day, datathon, ideathon, buildathon, makeathon,
   designathon, game jam (e code/ai/dev jam; "jam" sozinho não), maratona
   de programação/inovação, desafio de inovação, NASA Space Apps.
2. Palavra de "evento sobre o hackathon" antes do termo derruba:
   workshop, curso, palestra, mentoria, abertura, premiação, inscrição de
   mentores/jurados/voluntários, "learn to".
3. Sympla, Doity, Meetup e Luma exigem o termo. Nome neutro fica fora.
4. Devpost, TAIKAI, ETHGlobal, MLH, Devfolio, lablab, Hack Club e marcas só
   listam hackathon: nome neutro passa, mas sai projeto de disciplina,
   organizador vazio ("nill"), evento só pra membros de um clube ou
   faculdade (Devpost, linha extra no "Who can participate"), prêmio abaixo
   de US$ 200 com menos de 100 inscritos, e Devpost com menos de 10
   inscritos sem prêmio nem destaque. Prêmio pequeno com muita gente fica.
5. Curadoria, indicação aprovada (`comunidade`) e evento do admin (`admin`)
   não passam pelo filtro.

Recusado que já estava no banco vira `active=0` com `excludedReason`
(nada é apagado). A cada rodada o scraper também reclassifica as linhas
ativas que a busca do dia não trouxe.

**Brasileiro pode participar?** (`brazilOk`, migration 026)

`sim` e `nao` só com evidência; sem evidência fica vazio ("não informado").
O trecho da regra vai em `eligibilityNote` e o link em `eligibilityUrl`.

- Devpost: bloco "Who can participate" da página. "All countries,
  excluding …" e "Specific countries excluded" (lista no tooltip ou no
  modal): `nao` se o Brasil está na lista. "Only specific countries
  included" e "US only": `sim` só se o Brasil está incluído. **A lista
  "standard exceptions" do Devpost inclui o Brasil** (lei de sorteio), então
  quase todo hackathon global de lá não aceita brasileiro (106 de 107 em
  15/10).
- Texto livre (página da marca, lablab, Devfolio): só frase explícita vale,
  tipo "Open worldwide, except …" ou "open only to residents of …".
  "Global hackathon" sozinho não prova nada.
- Evento no Brasil (presencial aqui ou online de fonte brasileira): `sim`,
  nota "Acontece no Brasil."
- O resto fica vazio. ETHGlobal, MLH, Luma de fora, Devfolio e Hack Club não
  publicam regra de país legível.

A página do Devpost só é lida pra quem passou no filtro, no máximo 120 por
rodada (1 por segundo, maior prêmio primeiro). O resultado fica no banco
(`eligibilityCheckedAt`) e só é relido depois de 3 dias.

**Alcance** (`scope`): `global`, `latam`, `brasil`, `pais` (com `country`,
ex.: "só EUA") ou `cidade`. **Região** (`region`, migration 023) continua:
`br`, `online-br`, `online-mundo`, `exterior`. País explícito da fonte manda
sobre a heurística de UF ("Cluj-Napoca, RO" é Romênia).

**Onde aparece**

- `/radar`: "No Brasil" (por UF), "Online e abertos pra brasileiros" (por
  prazo e, no mesmo dia, maior prêmio), "Presencial lá fora", "Não
  informado se brasileiro pode" e, fechado no fim, "Não aceitam
  brasileiros". 12 cards por seção e "mostrar mais". Filtros: onde
  (Brasil/global/outros países), estado, formato, aberto pra brasileiros,
  prazo (semana/mês), prêmio (com prêmio/US$ 10 mil+) e tema. Card com
  selos: "online · global", "aberto pra brasileiros", "US$ 50 mil",
  "fecha em 3 dias". A edição Hack Inova entra no Brasil como as outras.
- Landing: amostra de 4 com edições da casa e Brasil na frente e 1–2
  globais online abertos pra brasileiros (maior prêmio). Nada que feche em
  menos de 48h. O "+N" conta o radar inteiro que ainda dá pra entrar e não
  exclui brasileiro.
- `/h/[id]` de evento externo: bloco "antes de se inscrever" com alcance,
  brasileiro pode (trecho e link da regra), prazos, prêmio (moeda original
  e aproximado em real, câmbio fixo de 5,5) e o CTA do site oficial.
- Painel: só Brasil, com a UF do perfil na frente.

**Frescor**: o cron roda 05:20 e 17:20 UTC em prod (05:15 stage). Expirado
sai da lista na hora pelo filtro `isOver`, sem depender do cron. Custo por
rodada: ~4 páginas da API do Devpost + até 120 páginas de regra (na prática
~30 com o cache), ~25 chamadas à API do Luma, ~12 ao Jina, ~10 nas outras
fontes. Uma rodada leva uns 5 minutos.

**Curadoria manual**: no `/admin`, "indicações" aprova com 1 clique (vira
evento `comunidade`). O formulário de criar edição aceita link oficial e
prêmio; organizador que não é Hack Inova grava `source='admin'`.

**Calendário WoHackers** (`scripts/import_wohackers.py`): importa a
planilha-calendário da comunidade WoHackers como curadoria, com crédito
"via calendário WoHackers" no organizador e o link original. **Não está
rodando**: a planilha é trabalho da comunidade e só entra depois que o dono
combinar com ela. Sem `--apply` o script só mostra o que entraria.

## Variáveis de ambiente (`~/hackahub-secrets/<env>.env`)

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Postgres do ambiente |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_*_URL` | auth (stage usa instância dev; prod precisa de instância de produção) |
| `NEXT_PUBLIC_SITE_URL` | canonical/OG/sitemap |
| `HACKAHUB_ADMIN_EMAILS` | admins globais (lista separada por vírgula; só promove, ver Admins) |
| `HACKAHUB_DEPLOY_TOOL` | só `on` liga o deploy tool — **nunca em prod nesta máquina** |
| `HACKAHUB_TICKET_SECRET` | HMAC do QR do ingresso (trocar invalida os QRs emitidos) |
| `HACKAHUB_CRON_SECRET` | bearer do `/api/cron/deliveries` (cron a cada 2 min, `ops/deliveries.sh`; a mesma passada dispara a pesquisa NPS pós-edição — idempotente, sem crontab novo) e do `/api/cron/submissions` (lembretes da entrega, cron a cada 5 min, `ops/submissions.sh`) e `/api/cron/rsvp` |
| `RESEND_API_KEY`, `HACKAHUB_EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | e-mail dos avisos; sem eles as entregas ficam `skipped` |
| `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY` | WhatsApp individual dos avisos (opt-in); sem eles `skipped` |
| `HACKAHUB_SECURITY_CONTACT` | opcional: contato do `/.well-known/security.txt` (padrão `mailto:seguranca@jazzautomations.com.br`). O `Expires` vence em 14/10/2027 |

## Pendências que só o fundador resolve

- ~~Domínio + DNS~~ feito 14/10: A `hackahub` → 64.181.217.112 e CNAMEs do Clerk na Vercel (time jazzautomations-projects).
- ~~Clerk produção~~ feito 14/10: app `devin-clerk` (app_3KfPwFLzP7FbETFuvIOMfO8DmNb) na conta jazzautomations@gmail.com, instância prod no domínio, chaves live em `prod.env`. CLI linkado em `~/hackahub-clerk` na VPS (`npx clerk deploy status`). O CLI não roda no notebook (CPU sem AVX → SIGILL).
- ~~Login com Google~~ feito 14/10: cliente OAuth "HackaHub Clerk" no Google Cloud (conta jazzautomations), redirect `https://clerk.hackahub.jazzautomations.com.br/v1/oauth_callback`, aplicado com `npx clerk config patch --instance prod --file ~/hackahub-secrets/google-oauth.json` em `~/hackahub-clerk`. O app precisa estar **publicado** (Público → Publicar) pra qualquer conta Google entrar.
- `HACKAHUB_ADMIN_EMAILS` em stage/prod: definir quem é admin.
- Provedor de e-mail (Resend) + SPF/DKIM/DMARC no domínio.
- Número de WhatsApp da Hack Inova na Evolution.
- Instalar o monitor externo no imac-server (`deploy/monitor/README.md`).
- Guardar os segredos fora da VPS (gerenciador de senhas ou chave `age` do `secrets.tar.age`).
- Aplicar `deploy/crontab.txt` e rodar `pg-roles.sh` (seções Cron e Roles do Postgres).
- Encarregado (DPO) e texto jurídico de termos/privacidade.
