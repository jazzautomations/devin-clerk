-- 030 — seguir comunidade. Quem é membro já segue (community_members vale
-- como "segue"); esta tabela é o "seguir" leve de quem NÃO quer ser membro
-- (comunidade de outra cidade, de outra faculdade). Quem segue vê o mural,
-- os avisos e os hackathons dela no /feed e no painel e recebe o anúncio de
-- hackathon publicado; não posta no mural, não recebe notificação de aviso
-- nem conta como membro. Entrar na comunidade apaga a linha daqui.

CREATE TABLE community_follows (
  "communityId" INTEGER NOT NULL REFERENCES communities("id") ON DELETE CASCADE,
  "memberId" INTEGER NOT NULL REFERENCES members("id"),
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("communityId", "memberId")
);
CREATE INDEX idx_community_follows_member ON community_follows ("memberId");

-- o feed "minhas comunidades" ordena aviso e post por data dentro das
-- comunidades seguidas
CREATE INDEX idx_hackathons_community_published ON hackathons ("communityId", "publishedAt");
