-- 020 — recompensa da inscrição paga uma vez só por (membro, edição)
-- (auditoria 041, pacote C: xp-farm-cancelar-reinscrever).
--
-- completeRegistration pagava +50 XP toda vez que a pessoa se inscrevia de
-- novo depois de cancelar. A marca fica aqui, fora de registrations (sem FK
-- pra ela), então sobrevive ao DELETE do cancelamento. Excluir a conta
-- apaga a marca junto com o resto (FK em members).
CREATE TABLE IF NOT EXISTS registration_rewards (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id") ON DELETE CASCADE,
  "rewardedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("memberId", "hackathonId")
);

-- quem já tem a carta da edição já recebeu a recompensa (a carta só sai
-- em completeRegistration)
INSERT INTO registration_rewards ("memberId", "hackathonId", "rewardedAt")
SELECT "memberId", "hackathonId", "awardedAt" FROM member_cards
ON CONFLICT DO NOTHING;
