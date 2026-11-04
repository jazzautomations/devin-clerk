-- 043 — bicho do builder (spec 046, onda 1, bicho-motor-e-criador).
--
-- members."mascote": config do bicho em JSON, validado em
-- lib/mascote/validar.ts antes de gravar. NULL = a pessoa não montou e o
-- bicho sai da semente do id (lib/mascote/semente.ts), sempre o mesmo.
-- members."mascoteUpdatedAt": quando o config mudou pela última vez.
-- Os dois são pessoais e zeram na exclusão de conta (ANONYMIZE em
-- lib/privacy.ts). IF NOT EXISTS: outra branch da mesma onda pode subir
-- antes sem derrubar o boot.
ALTER TABLE members ADD COLUMN IF NOT EXISTS "mascote" TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS "mascoteUpdatedAt" TEXT;
