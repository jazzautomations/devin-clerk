-- 031 — base de confiança da rede social (spec 046, evidencia-e-lgpd).
--
-- 1) members."lastSeenAt": quando a pessoa usou o HackaHub logada pela
--    última vez (gravado no máximo 1x por hora em lib/session.ts). O digest e
--    as métricas usam pra saber quem voltou. Conta excluída zera (ANONYMIZE
--    em lib/privacy.ts). Quem já existe parte da data do cadastro.
ALTER TABLE members ADD COLUMN "lastSeenAt" TEXT;
UPDATE members SET "lastSeenAt" = "createdAt" WHERE "lastSeenAt" IS NULL;

-- 2) notifications."actorId": quem causou a notificação, por id. O
--    actorUsername continua (texto congelado pra exibir), mas a regra "1 por
--    par" (alreadyNotified) não pode furar quando a pessoa troca de @.
--    O histórico casa pelo @ atual; o que não casar fica NULL.
ALTER TABLE notifications ADD COLUMN "actorId" INTEGER REFERENCES members("id") ON DELETE SET NULL;
UPDATE notifications n SET "actorId" = m."id"
  FROM members m
  WHERE n."actorId" IS NULL AND n."actorUsername" IS NOT NULL AND m."username" = n."actorUsername";
CREATE INDEX idx_notifications_actor_pair ON notifications ("memberId", "type", "actorId", "href");
