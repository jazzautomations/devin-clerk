-- 049 — repost e citação (spec 046, onda 4).
--
-- Compartilhar o post de alguém sem inventar placar: o repost só espalha, a
-- citação comenta por cima, e quem escreveu decide se aceita citação (como no
-- Mastodon 4.5). Nada disso dá XP, badge ou seguidor (plano 046, naoFazer):
-- compartilhar é circulação, não recompensa.

-- Repost puro: body vazio e "repostOfId" apontando pro original. O conteúdo
-- do repost é o do original, então apagar o original leva os reposts junto
-- (mesmo com reação neles — reação e comentário já vão em cascade desde a
-- 034). Citar um repost cita o original: ninguém reposta repost.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS "repostOfId" INTEGER REFERENCES posts("id") ON DELETE CASCADE;

-- Citação: post com corpo próprio que mostra o original numa caixa. Apagar o
-- original não apaga a citação: ela fica e mostra "post apagado".
ALTER TABLE posts ADD COLUMN IF NOT EXISTS "quoteOfId" INTEGER REFERENCES posts("id") ON DELETE SET NULL;

-- A pessoa decide se o post aceita citação. 1 (aceita) é o padrão: a opção
-- de recusar existe pra quem já sabe que o post vai render treta.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS "allowQuote" INTEGER NOT NULL DEFAULT 1;

-- Uma pessoa reposta o mesmo post uma vez só: o botão é toggle e a corrida de
-- dois cliques cai no índice, não em dois reposts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_repost_once ON posts ("memberId", "repostOfId") WHERE "repostOfId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_repost_of ON posts ("repostOfId");
CREATE INDEX IF NOT EXISTS idx_posts_quote_of ON posts ("quoteOfId");
