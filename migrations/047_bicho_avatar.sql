-- 047 — bicho como avatar e evolução por fato verificado (spec 046, onda 4).
--
-- O bicho vira a cara da pessoa em toda lista (feed, comentário, /membros,
-- inscritos, teamboard, OG) sem mexer em cada query: as listas continuam
-- lendo members."avatarUrl", e é ele que guarda a URL do SVG do bicho.
--
-- "avatarKind" decide quem manda no avatarUrl:
--   'foto'  (padrão) o sync do Clerk grava a foto do Clerk em avatarUrl;
--   'bicho' o avatarUrl é o do bicho e o login NÃO sobrescreve.
-- "clerkImageUrl" guarda sempre a última foto do Clerk, pra voltar pra ela
-- com um clique (o avatarUrl de quem usa bicho deixa de ser a foto).
-- "mascoteItens" é o JSON com até 3 itens escolhidos (NULL = os 3 mais
-- recentes que o fato destravou).
--
-- mascote_unlocks só serve pra notificar uma vez por item: a fonte de verdade
-- do destrave é o fato (lib/evidence.ts, countFacts), recalculado pelo cron
-- /api/cron/xp. Item nunca vem de like, post, comentário ou seguidor.
--
-- Tudo idempotente: outra branch da mesma onda pode subir antes sem derrubar
-- o boot, e rodar de novo não quebra nem duplica.
ALTER TABLE members ADD COLUMN IF NOT EXISTS "avatarKind" TEXT NOT NULL DEFAULT 'foto'
  CHECK ("avatarKind" IN ('foto', 'bicho'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS "clerkImageUrl" TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS "mascoteItens" TEXT;

-- a foto de hoje vira a reserva do Clerk (o bicho nunca entra aqui)
UPDATE members SET "clerkImageUrl" = "avatarUrl"
 WHERE "clerkImageUrl" IS NULL
   AND "avatarUrl" IS NOT NULL
   AND "avatarUrl" NOT LIKE '/api/mascote/%';

CREATE TABLE IF NOT EXISTS mascote_unlocks (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "itemId" TEXT NOT NULL,
  "unlockedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("memberId", "itemId")
);
