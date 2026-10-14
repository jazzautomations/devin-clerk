-- 009 — dia do evento à prova de Wi-Fi ruim (roadmap 037 Onda 1 #5,
-- pesquisa 035 #6–7).
--
-- ticket_emails: outbox do e-mail de aprovação com o QR do ingresso. Uma
-- linha por inscrição — a PK é a idempotência (aprovar de novo, promover da
-- fila duas vezes ou rodar o worker em paralelo nunca manda dois e-mails).
-- Reenvio manual do organizador incrementa "sends" (entra na chave de
-- idempotência do Resend) e volta a linha pra 'queued'.
CREATE TABLE ticket_emails (
  "registrationId" INTEGER PRIMARY KEY REFERENCES registrations("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','sent','failed','skipped')),
  "sends" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "nextAttemptAt" TEXT,
  "claimedAt" TEXT,
  "sentAt" TEXT,
  "requestedBy" INTEGER REFERENCES members("id") ON DELETE SET NULL,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now()
);
CREATE INDEX idx_ticket_emails_pending ON ticket_emails ("status", "nextAttemptAt");

-- check-in offline: "at" passa a poder vir do aparelho (horário real da
-- leitura, limitado à janela da edição); syncedAt é quando o servidor
-- recebeu. via = online | offline | walkin (NULL = antes desta migration).
ALTER TABLE checkins ADD COLUMN "via" TEXT;
ALTER TABLE checkins ADD COLUMN "syncedAt" TEXT;
