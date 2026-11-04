-- 039 — menções @ e tags # (spec 046, onda 2, mencoes-e-tags).
--
-- Sem algoritmo, a descoberta acontece por menção e por hashtag. Aqui ficam
-- os dois índices derivados do texto do post e do comentário, reescritos a
-- cada create/update por lib/tags.ts (syncMentionsAndTags). O texto em si
-- continua em posts.body / post_comments.body: nada de HTML guardado.
--
-- post_mentions: quem foi mencionado e onde. commentId nulo = menção no
-- corpo do post; preenchido = menção num comentário. A menção só existe se o
-- @ for de membro que existe, não foi excluído e não tem bloqueio com quem
-- escreveu — a regra mora no código, a tabela é o resultado dela.
-- Os índices únicos parciais são dois porque commentId nulo não compara
-- igual: um por post, outro por comentário.

CREATE TABLE IF NOT EXISTS post_mentions (
  "postId" INTEGER NOT NULL REFERENCES posts("id") ON DELETE CASCADE,
  "commentId" INTEGER REFERENCES post_comments("id") ON DELETE CASCADE,
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_mentions_post
  ON post_mentions ("postId", "memberId") WHERE "commentId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_mentions_comment
  ON post_mentions ("commentId", "memberId") WHERE "commentId" IS NOT NULL;
-- "onde me mencionaram" (perfil e sino) e limpeza por membro
CREATE INDEX IF NOT EXISTS idx_post_mentions_member ON post_mentions ("memberId");

-- post_tags: índice da hashtag do post, já normalizado por normalizeTech
-- (lib/techTags.ts) — #NextJS, #next.js e #nextjs caem na mesma tag nextjs.
-- Comentário não entra no índice: tag de comentário não tem página própria.
CREATE TABLE IF NOT EXISTS post_tags (
  "postId" INTEGER NOT NULL REFERENCES posts("id") ON DELETE CASCADE,
  "tag" TEXT NOT NULL CHECK ("tag" ~ '^[a-z0-9][a-z0-9.+#-]{0,29}$'),
  PRIMARY KEY ("postId", "tag")
);

-- /tag/[tag]: posts da tag em ordem de id desc
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags ("tag", "postId" DESC);
