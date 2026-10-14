-- Roles do Postgres do HackaHub sem superusuário (achado pg-superuser-compartilhado, F4).
-- Hoje prod, stage, dev e e2e usam o superusuário `hackahub`, que consegue
-- apagar o banco de prod a partir do stage. Depois deste script:
--   hh_prod  → só o banco hackahub
--   hh_stage → só o banco hackahub_stage
--   hh_dev   → hackahub_dev e os hackahub_e2e* (desenvolvimento e testes)
-- Nenhum deles é superusuário nem cria banco/role. O `hackahub` continua
-- existindo pro backup (pg_dump) e pra manutenção, mas sai de todos os .env.
--
-- Rodar pelo pg-roles.sh (o dono aplica, numa janela curta), que passa as
-- senhas e depois troca o dono dos objetos dentro de cada banco.
-- Depois: trocar DATABASE_URL em prod.env/stage.env (e os url.* de dev/e2e)
-- pra postgres://hh_<env>:<senha>@127.0.0.1:5434/<banco>, reiniciar os
-- serviços e conferir no /api/health. Teste do isolamento:
--   psql "$(sed 's#/hackahub_stage#/hackahub#' ~/hackahub-secrets/url.hackahub_stage)" -c 'select 1'
--   → tem que falhar com "permission denied for database".
-- É idempotente: rodar de novo só reaplica dono e permissões (sem trocar senha
-- de role que já existe).

\set ON_ERROR_STOP 1

-- roles ----------------------------------------------------------------------
SELECT format('CREATE ROLE hh_prod LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'pw_prod')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hh_prod') \gexec
SELECT format('CREATE ROLE hh_stage LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'pw_stage')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hh_stage') \gexec
SELECT format('CREATE ROLE hh_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'pw_dev')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hh_dev') \gexec

-- bancos: dono + só o dono conecta ------------------------------------------
-- (PUBLIC perde CONNECT; o superusuário conecta sempre)
SELECT format('ALTER DATABASE %I OWNER TO %I', datname,
              CASE datname WHEN 'hackahub' THEN 'hh_prod' WHEN 'hackahub_stage' THEN 'hh_stage' ELSE 'hh_dev' END)
  FROM pg_database
 WHERE datname = 'hackahub' OR datname = 'hackahub_stage' OR datname = 'hackahub_dev' OR datname LIKE 'hackahub\_e2e%'
 ORDER BY datname \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', datname)
  FROM pg_database
 WHERE datname = 'hackahub' OR datname = 'hackahub_stage' OR datname = 'hackahub_dev' OR datname LIKE 'hackahub\_e2e%' \gexec

-- os objetos de dentro de cada banco (tabelas, sequências, funções) mudam
-- de dono no pg-roles.sh, que conecta em um banco por vez.
