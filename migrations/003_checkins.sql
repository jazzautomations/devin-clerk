-- 003 — check-in no dia (spec 033 US4). Uma linha por inscrição presente:
-- a PK em registrationId é o que torna a leitura do QR idempotente.
-- Cancelar a inscrição leva a presença junto; staff removido não apaga o
-- registro de quem marcou, só zera o autor.

CREATE TABLE checkins (
  "registrationId" INTEGER PRIMARY KEY REFERENCES registrations("id") ON DELETE CASCADE,
  "at" TEXT NOT NULL DEFAULT sqlite_now(),
  "byMemberId" INTEGER REFERENCES members("id") ON DELETE SET NULL
);
