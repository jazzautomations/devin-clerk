-- 040 — notificações agrupadas, preferências e resumo semanal (spec 046,
-- notificacoes-boas).
--
-- notification_prefs: uma linha só quando a pessoa mexeu. Sem linha vale o
-- padrão de lib/notifications.ts (DEFAULT_PREFS): social e comunidade
-- chegam no app, o resumo semanal chega por e-mail. O grupo "essencial"
-- (inscrição, ingresso, RSVP, júri, certificado) não tem linha: não desliga.
-- memberId é dono da linha (lib/privacy.ts): excluir a conta apaga.
CREATE TABLE IF NOT EXISTS notification_prefs (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "group" TEXT NOT NULL CHECK ("group" IN ('social', 'comunidade', 'digest')),
  "inApp" INTEGER NOT NULL DEFAULT 1 CHECK ("inApp" IN (0, 1)),
  "email" INTEGER NOT NULL DEFAULT 0 CHECK ("email" IN (0, 1)),
  "updatedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("memberId", "group")
);

-- digest_sends: uma linha por pessoa por semana ISO no horário de Brasília
-- ("2026-W44"). A PK é a trava de idempotência do cron: duas execuções na
-- mesma semana mandam uma vez. status:
--   enviando  reservado por uma execução (vira um dos outros no fim)
--   enviado   o Resend aceitou
--   pulado    sem RESEND_API_KEY, e-mail com bounce ou resumo desligado no meio
--   vazio     nada pra contar na semana, nada saiu
--   falhou    erro do Resend ou da rede; a próxima execução tenta de novo
CREATE TABLE IF NOT EXISTS digest_sends (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "week" TEXT NOT NULL CHECK ("week" ~ '^\d{4}-W\d{2}$'),
  "status" TEXT NOT NULL CHECK ("status" IN ('enviando', 'enviado', 'pulado', 'vazio', 'falhou')),
  "reason" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("memberId", "week")
);
CREATE INDEX IF NOT EXISTS idx_digest_sends_week ON digest_sends ("week", "status");

-- a lista paginada por cursor (id < antes) do /notificacoes
CREATE INDEX IF NOT EXISTS idx_notifications_member_id ON notifications ("memberId", "id" DESC);
