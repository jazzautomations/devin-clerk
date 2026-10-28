-- 033 — seguir pessoa (spec 046, onda 1). memberId segue followedId.
--
-- Sem placar: ninguém vê quantos seguem outra pessoa. O dono vê os próprios
-- números e as próprias listas; quem visita vê só "segue você". followedId
-- está em PEER_COLUMNS (lib/privacy.ts): se qualquer lado excluir a conta, a
-- linha some. Bloquear apaga o seguir nos dois sentidos (lib/blocks.ts).

CREATE TABLE member_follows (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "followedId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("memberId", "followedId"),
  CHECK ("memberId" <> "followedId")
);
-- /perfil/seguidores: quem me segue, do mais novo pro mais velho
CREATE INDEX idx_member_follows_followed ON member_follows ("followedId", "createdAt" DESC);
