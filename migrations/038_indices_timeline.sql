-- 038 — índices da timeline (spec 046, onda 2). Só índice: nenhuma coluna
-- nova, nenhum dado novo.
--
-- A timeline lê post por id DESC em três recortes: autor (aba seguindo),
-- edição (aba ao vivo) e comunidade. O composto cobre o filtro e a ordenação
-- na mesma passada. O idx_posts_community (027) fica redundante com o
-- composto de comunidade e sai.
CREATE INDEX idx_posts_member_id ON posts ("memberId", "id" DESC);
CREATE INDEX idx_posts_hackathon_id ON posts ("hackathonId", "id" DESC);
CREATE INDEX idx_posts_community_id ON posts ("communityId", "id" DESC);
DROP INDEX IF EXISTS idx_posts_community;
