-- 009 — modo palco: a final ao vivo de uma edição (spec 033, frente F — specs/033-hackinova-ops/palco.md).
-- Todo o estado do palco mora aqui (e não em memória do processo): o telão,
-- o celular de quem vota e o controle do organizador leem do banco, então
-- restart/deploy no meio da final não perde pitch, cronômetro nem voto.
--
-- Cronômetro com pausa: "pitchElapsedMs" acumula o tempo já corrido antes
-- da rodada atual; "pitchStartedAt" (UTC com milissegundo,
-- 'YYYY-MM-DD HH:MM:SS.sss') só existe enquanto está rodando.

CREATE TABLE stage_sessions (
  "hackathonId" TEXT PRIMARY KEY REFERENCES hackathons("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'idle' CHECK ("status" IN ('idle', 'live', 'ended')),
  "currentTeamId" INTEGER REFERENCES teams("id") ON DELETE SET NULL,
  "pitchSeconds" INTEGER NOT NULL DEFAULT 180 CHECK ("pitchSeconds" BETWEEN 30 AND 1800),
  "pitchStartedAt" TEXT,
  "pitchElapsedMs" INTEGER NOT NULL DEFAULT 0,
  "votingOpen" INTEGER NOT NULL DEFAULT 0 CHECK ("votingOpen" IN (0, 1)),
  "updatedAt" TEXT NOT NULL DEFAULT sqlite_now()
);

-- ordem dos pitches; um time aparece uma vez por edição
CREATE TABLE stage_queue (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id") ON DELETE CASCADE,
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  PRIMARY KEY ("hackathonId", "teamId")
);
CREATE INDEX idx_stage_queue_order ON stage_queue ("hackathonId", "position");

-- voto do público: nota 1–5 por pessoa por pitch. O UNIQUE é o que torna o
-- voto editável (upsert) sem nunca contar duas vezes.
CREATE TABLE live_votes (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id") ON DELETE CASCADE,
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "score" INTEGER NOT NULL CHECK ("score" BETWEEN 1 AND 5),
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  "updatedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE ("hackathonId", "memberId", "teamId")
);
CREATE INDEX idx_live_votes_team ON live_votes ("hackathonId", "teamId");
