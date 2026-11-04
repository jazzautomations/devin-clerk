-- 035 — nível por entrega verificada (spec 046, nivel-por-entrega).
--
-- members.xp deixa de ser somado por ação (post, comentário, curtida,
-- inscrição, time) e passa a ser derivado dos fatos de lib/evidence.ts,
-- recalculado pelo cron /api/cron/xp (lib/xp.ts → recomputeAll).
-- "xpLegado" guarda o valor de antes, pra auditoria e rollback. Não aparece
-- na UI; é número, não dado pessoal (KEEP_ON_ANONYMIZE em lib/privacy.ts).
-- Conta nova nasce com NULL: não tinha xp antigo.
ALTER TABLE members ADD COLUMN IF NOT EXISTS "xpLegado" INTEGER;
UPDATE members SET "xpLegado" = "xp" WHERE "xpLegado" IS NULL;
