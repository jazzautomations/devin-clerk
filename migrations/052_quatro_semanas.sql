-- 052 — 4 semanas depois (spec 046, onda 5).
--
-- Acompanhamento pós-edição: o organizador abre um período de 2 a 8 semanas
-- (padrão 4) depois do evento, os times que entregaram entram, e cada semana
-- conta quando o time posta uma atualização no diário do projeto
-- (posts."teamId", migration 044) dentro da janela da semana. Time com todas
-- as semanas leva o selo 'quatro-semanas' (lib/game.ts) — o item estrela do
-- bicho vem depois, pelo cron de XP (migration 047).
--
-- O nome não é "temporada": a spec 043 usa temporada pra semestre. Aqui é o
-- acompanhamento das 4 semanas depois da edição, o "Colosseum Eternal" do
-- roadmap 037 #14.
--
-- Semana vazia não apaga nada e não existe notificação de sequência: o
-- lembrete de quinta é um lembrete só, uma vez por semana (remindedAt).
--
-- Semana é contada em Brasília (lib/eventTime.ts): o Brasil não tem mais
-- horário de verão desde 2019, então 7 dias exatos a partir de "startsAt"
-- caem na mesma hora de parede da semana seguinte.
--
-- LGPD (lib/privacy.ts): "createdBy" é ator — quem abriu fica apontando pra
-- linha anonimizada, como meetups."createdBy" (051). Nenhuma tabela aqui
-- guarda coluna de pessoa: o integrante do time vem de team_members.

CREATE TABLE follow_through (
  "hackathonId" TEXT PRIMARY KEY REFERENCES hackathons("id") ON DELETE CASCADE,
  -- quando a semana 1 começa (TEXT UTC, convenção do schema)
  "startsAt" TEXT NOT NULL,
  "weeks" INTEGER NOT NULL DEFAULT 4 CHECK ("weeks" BETWEEN 2 AND 8),
  -- demo day de fechamento (meetups, 051) — sem FK de propósito: a agenda é
  -- de outra comunidade e o meetup pode ser apagado sem levar isto junto
  "demoMeetupId" INTEGER,
  "createdBy" INTEGER REFERENCES members("id"),
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  -- NULL = período aberto. Preenchido no fim das semanas ou no encerramento
  -- antes do prazo (aí com closedReason escrito pela organização).
  "closedAt" TEXT,
  "closedReason" TEXT
);

-- times que entraram: só time com entrega na edição (project_submissions)
CREATE TABLE follow_through_teams (
  "hackathonId" TEXT NOT NULL REFERENCES follow_through("hackathonId") ON DELETE CASCADE,
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "joinedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "teamId")
);
CREATE INDEX idx_follow_through_teams_team ON follow_through_teams ("teamId");

-- semana a semana: postId NULL = semana ainda sem atualização. O cron
-- materializa uma linha por time por semana que já começou, pra guardar o
-- lembrete (remindedAt) e o selo sem varrer posts de novo.
CREATE TABLE follow_through_weeks (
  "hackathonId" TEXT NOT NULL,
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "week" INTEGER NOT NULL CHECK ("week" BETWEEN 1 AND 8),
  "postId" INTEGER REFERENCES posts("id") ON DELETE SET NULL,
  "markedAt" TEXT,
  "remindedAt" TEXT,
  PRIMARY KEY ("hackathonId", "teamId", "week"),
  FOREIGN KEY ("hackathonId", "teamId")
    REFERENCES follow_through_teams("hackathonId", "teamId") ON DELETE CASCADE
);
CREATE INDEX idx_follow_through_weeks_post ON follow_through_weeks ("postId");
