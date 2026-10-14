-- spec 039 — landing, acesso e onboarding.
--
-- 1) /organizar: quem quer rodar uma edição deixa contato na mesma fila de
--    leads do /empresas, com interesse próprio.
ALTER TABLE leads DROP CONSTRAINT leads_interest_check;
ALTER TABLE leads ADD CONSTRAINT leads_interest_check
  CHECK ("interest" IN ('desafio','edicao','talento','outro','organizar'));

-- 2) onboarding (/bem-vindo): intenção declarada e perfil básico. Cidade,
--    instituição e curso são opcionais (ajudam o CSV de hora complementar);
--    data de nascimento continua só na inscrição da edição.
ALTER TABLE members ADD COLUMN "onboardedAt" TEXT;
ALTER TABLE members ADD COLUMN "intents" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN "city" TEXT;
ALTER TABLE members ADD COLUMN "institution" TEXT;
ALTER TABLE members ADD COLUMN "course" TEXT;

-- quem já existe não é forçado a passar pelo onboarding: marca todo mundo
-- que tem conta hoje (com ou sem perfil preenchido) com a data do cadastro
UPDATE members SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
