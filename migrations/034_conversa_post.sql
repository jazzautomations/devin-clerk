-- 034 — conversa no post (spec 046, onda 1).
--
-- Post ganha endereço (/post/[id]), 4 reações, respostas em 1 nível e
-- edição. A denúncia continua na fila única (reports, migration 032).
--
-- As FKs likes.postId e post_comments.postId (001) nasceram sem cascade:
-- apagar post exigia apagar a mão o que pendia dele. Aqui elas são
-- recriadas com ON DELETE CASCADE. O nome da constraint é lido de
-- pg_constraint porque o Postgres gerou o nome em 001.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'posts'::regclass
      AND c.conrelid IN ('likes'::regclass, 'post_comments'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE likes
  ADD CONSTRAINT "likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES posts("id") ON DELETE CASCADE;
ALTER TABLE post_comments
  ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES posts("id") ON DELETE CASCADE;

-- edição pelo autor: o card mostra "editado"
ALTER TABLE posts ADD COLUMN IF NOT EXISTS "editedAt" TEXT;

-- reação: uma por pessoa por post (a PK (postId, memberId) continua);
-- o like antigo vira 'curti'
ALTER TABLE likes ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'curti'
  CHECK ("kind" IN ('curti', 'ajudou', 'quero_testar', 'aprendi'));

-- resposta em 1 nível: parentId aponta pra um comentário de topo do mesmo
-- post (validado em lib/comments.ts). Apagar o comentário leva as respostas.
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS "parentId" INTEGER REFERENCES post_comments("id") ON DELETE CASCADE;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS "editedAt" TEXT;
CREATE INDEX IF NOT EXISTS idx_post_comments_parent ON post_comments ("parentId");
CREATE INDEX IF NOT EXISTS idx_likes_member ON likes ("memberId");
