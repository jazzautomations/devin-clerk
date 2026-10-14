-- Anúncio de edição nova pra comunidade (decisão do dono, 14/10/2026: a
-- próxima edição não é divulgada antes; quem tem conta fica sabendo quando
-- ela sai). Marca a primeira vez que a edição foi anunciada pra todos os
-- membros. O que já está no ar hoje conta como anunciado.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "launchAnnouncedAt" TEXT;
UPDATE hackathons SET "launchAnnouncedAt" = sqlite_now()
  WHERE "active" = 1 AND "launchAnnouncedAt" IS NULL;
