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
| Ops | `~/hackahub/ops/` (`deploy.sh`, `backup.sh`, `restore-drill.sh`, `scrape.sh`), logs em `~/hackahub/logs/` |
| Backups | `~/hackahub-backups/<stamp>/` (14 dias) + bucket OCI `hackahub-backups` (prefixo `hackahub/`, expira em 60 dias) |
| Scraper | venv `~/hackahub/scraper/.venv` (uv) |
| Cron (usuário ubuntu) | 05:15/05:20 UTC radar (stage/prod) · 06:00 UTC backup · dom 06:30 UTC restore drill · */2 min fila de avisos · */5 min entregas (lembretes/trava) · */15 min RSVP · */10 min guarda de disco |

Portas de app não são públicas: security list da OCI só abre 22/80/443 e o
iptables rejeita o resto (verificado de fora em 14/10/2026).

## Deploy

```bash
# no notebook, a partir de um commit limpo
git archive --format=tar.gz -o /tmp/hh.tar.gz HEAD
scp /tmp/hh.tar.gz ubuntu@64.181.217.112:~/hackahub-secrets/hh-release.tar.gz
ssh ubuntu@64.181.217.112 'bash ~/hackahub/ops/deploy.sh stage ~/hackahub-secrets/hh-release.tar.gz'
# conferiu no stage → mesmo tarball pra prod
ssh ubuntu@64.181.217.112 'bash ~/hackahub/ops/deploy.sh prod ~/hackahub-secrets/hh-release.tar.gz'
```

`deploy.sh` cria um release novo, `npm ci` + `next build` com o env do
ambiente, troca o symlink `current`, reinicia o serviço e espera
`/api/health` (app + banco). Se o health não responder em 40 s, **volta
sozinho** pro release anterior. Mantém os 3 últimos releases.

Migrations rodam no boot do app (em ordem, com lock); deploy de migration
destrutiva precisa de plano expand/contract — não existe nenhuma hoje.

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
  descartável, compara contagens com a origem e apaga.
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

## Disco (VPS compartilhada)

Incidente 14/10/2026 04:33 UTC: builds paralelas de várias worktrees de
desenvolvimento encheram o disco (100%), o `hackahub-pg` caiu
(`No space left on device`) e prod/stage do HackaHub ficaram fora por ~10 min.
Outros serviços não registraram erro. Recuperação: apagar pastas de
desenvolvimento já mergeadas + `npm cache clean`, `docker restart hackahub-pg`,
reiniciar `hackahub-prod`/`hackahub-stage`. Dados íntegros.

Prevenção: `ops/disk-guard.sh` no cron (10 min) limpa sobras do HackaHub acima
de 90%; deploy mantém 2 releases; pasta de desenvolvimento sem `node_modules`
depois de mergeada; nunca mais de 3 builds simultâneas.

## Radar (scraper)

`ops/scrape.sh <stage|prod>` roda `scripts/scrape_radar.py` do release
atual contra o banco do ambiente. Fontes: Devpost, TAIKAI, Meetup,
curadoria; ETHGlobal e Luma costumam dar 0 (geogate); MLH responde mas o
parser voltou 0 em 14/10 — revisar.

## Variáveis de ambiente (`~/hackahub-secrets/<env>.env`)

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Postgres do ambiente |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_*_URL` | auth (stage usa instância dev; prod precisa de instância de produção) |
| `NEXT_PUBLIC_SITE_URL` | canonical/OG/sitemap |
| `HACKAHUB_ADMIN_EMAILS` | admins globais (lista separada por vírgula) |
| `HACKAHUB_DEPLOY_TOOL` | só `on` liga o deploy tool — **nunca em prod nesta máquina** |
| `HACKAHUB_TICKET_SECRET` | HMAC do QR do ingresso (trocar invalida os QRs emitidos) |
| `HACKAHUB_CRON_SECRET` | bearer do `/api/cron/deliveries` (cron a cada 2 min, `ops/deliveries.sh`; a mesma passada dispara a pesquisa NPS pós-edição — idempotente, sem crontab novo) e do `/api/cron/submissions` (lembretes da entrega, cron a cada 5 min, `deploy/submissions.sh` — ainda não instalado no crontab) |
| `RESEND_API_KEY`, `HACKAHUB_EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | e-mail dos avisos; sem eles as entregas ficam `skipped` |
| `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY` | WhatsApp individual dos avisos (opt-in); sem eles `skipped` |

## Pendências que só o fundador resolve

- ~~Domínio + DNS~~ feito 14/10: A `hackahub` → 64.181.217.112 e CNAMEs do Clerk na Vercel (time jazzautomations-projects).
- ~~Clerk produção~~ feito 14/10: app `devin-clerk` (app_3KfPwFLzP7FbETFuvIOMfO8DmNb) na conta jazzautomations@gmail.com, instância prod no domínio, chaves live em `prod.env`. CLI linkado em `~/hackahub-clerk` na VPS (`npx clerk deploy status`). O CLI não roda no notebook (CPU sem AVX → SIGILL).
- Login com Google em produção: desligado (`connection_oauth_google.enabled=false` na prod) até ter Client ID/Secret do Google Cloud; aí `clerk deploy` de novo e religar.
- `HACKAHUB_ADMIN_EMAILS` em stage/prod: definir quem é admin.
- Provedor de e-mail (Resend) + SPF/DKIM/DMARC no domínio.
- Número de WhatsApp da Hack Inova na Evolution.
- Monitor externo de uptime com alerta (ex.: Healthchecks/UptimeRobot em `/api/health` e no carimbo do backup).
- Encarregado (DPO) e texto jurídico de termos/privacidade.
