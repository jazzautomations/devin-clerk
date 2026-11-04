-- 041 — perfil rico (spec 046, onda 2).
--
-- O /u deixa de ser beco sem saída: números de fato (lib/evidence.ts),
-- depoimentos aceitos (037), comunidades como crachá, projetos fixados,
-- "posso ajudar com" / "quero ajuda com", atividade, OG próprio e uma versão
-- aberta pra quem não tem conta (opt-in). Mais o RECADO no perfil (estudo 044
-- §1.4), que reaproveita `posts` como escopo novo em vez de criar tabela:
-- ganha de graça edição, resposta, rate limit e moderação.
--
-- Reaproveita members.city, institution e course (migration 018): nenhuma
-- coluna de cidade ou faculdade nasce aqui. A UI chama institution de
-- "faculdade".

-- "posso ajudar com" e "quero ajuda com": JSON de chaves de lib/areas.ts
-- (subconjunto de PERSONAS), até 4 cada. Regra em lib/areas.ts.
ALTER TABLE members ADD COLUMN IF NOT EXISTS "helpOffer" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN IF NOT EXISTS "helpWant" TEXT NOT NULL DEFAULT '[]';

-- perfil aberto pra quem não tem conta (opt-in, padrão fechado)
ALTER TABLE members ADD COLUMN IF NOT EXISTS "publicProfile" INTEGER NOT NULL DEFAULT 0
  CHECK ("publicProfile" IN (0, 1));

-- quem pode deixar recado no perfil: conexoes (padrão) | todos | ninguem.
-- "conexoes" = mesmo time, mesma edição com check-in, mesma comunidade ou
-- seguir mútuo (lib/recados.ts).
ALTER TABLE members ADD COLUMN IF NOT EXISTS "recadosFrom" TEXT NOT NULL DEFAULT 'conexoes'
  CHECK ("recadosFrom" IN ('conexoes', 'todos', 'ninguem'));

-- projetos fixados: até 3, só time da própria pessoa (validado no código).
-- Apagar o time apaga o pin.
CREATE TABLE member_pins (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("memberId", "teamId")
);
CREATE INDEX idx_member_pins_member ON member_pins ("memberId", "position");

-- recado: post com escopo de perfil. profileId nulo = post normal.
-- Apagar a conta de quem recebe leva os recados junto; o autor está em
-- posts.memberId e também leva os seus (lib/privacy.ts).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS "profileId" INTEGER REFERENCES members("id") ON DELETE CASCADE;
CREATE INDEX idx_posts_profile ON posts ("profileId", "id" DESC);

-- um recado nunca é post de edição nem de comunidade: só um escopo por post.
-- (O par hackathonId/communityId antigo não é revalidado aqui pra não
-- derrubar migration em banco que já tenha linha dos dois.)
ALTER TABLE posts ADD CONSTRAINT "posts_profile_scope_check"
  CHECK ("profileId" IS NULL OR ("hackathonId" IS NULL AND "communityId" IS NULL));
