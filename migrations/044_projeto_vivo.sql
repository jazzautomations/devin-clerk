-- 044 — projeto vivo (spec 046, onda 3).
--
-- O projeto deixa de morrer com o evento: o time posta atualizações no
-- próprio diário, qualquer pessoa segue o projeto, a página conta as semanas
-- que o time constrói (cumulativo, nunca zera) e o projeto com commit depois
-- do evento ganha o selo "continuou". Reaproveita o que já existe:
-- team_projects.priorWork/priorExisted (010, 029) pra declaração, e o dossiê
-- de commits (029, lib/dossier.ts) como único coletor do GitHub.
-- Tudo idempotente: rodar de novo não quebra nem duplica.

-- 1. diário: o post ganha o time dono. Mora em posts porque edição, reação,
-- resposta, menção, denúncia e rate limit já vêm de graça (034, 039, 032).
-- Apagar o time leva o diário junto (a 034 deixou likes e comentários em
-- cascade, então o DELETE do post não trava em FK).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS "teamId" INTEGER REFERENCES teams("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_posts_team ON posts ("teamId", "id" DESC);

-- 2. seguir projeto: o seguir leve de quem quer acompanhar o diário sem
-- entrar no time. Sem contador público: a contagem é só do time.
CREATE TABLE IF NOT EXISTS project_follows (
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("memberId", "teamId")
);
CREATE INDEX IF NOT EXISTS idx_project_follows_team ON project_follows ("teamId");

-- 3. continuação entre edições: o projeto novo aponta pro anterior de que o
-- time fez parte (a declaração do que já existia continua em priorWork).
-- Apagar o time anterior só desliga o link.
ALTER TABLE team_projects ADD COLUMN IF NOT EXISTS "continuesTeamId" INTEGER REFERENCES teams("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_team_projects_continues ON team_projects ("continuesTeamId");

-- 4. selo "continuou": data do primeiro commit depois do fim da edição + 30
-- dias, derivada pelo cron (lib/continuity.ts) a partir do dossiê. NULL =
-- não continuou (ou o dossiê ainda não foi lido).
ALTER TABLE team_projects ADD COLUMN IF NOT EXISTS "continuedAt" TEXT;

-- 5. "Depois do hackathon" (afterNotes, 010) vira o primeiro post do diário:
-- o campo fica no banco (histórico e export) e sai da vitrine e do editor.
-- Só entra em projeto que ainda não tem post de diário, e só com o primeiro
-- integrante resolvido por username (time sem @ vinculado não tem autor).
-- Data do post: lastSavedAt do projeto (o "updatedAt" que ele tem, 010); sem
-- ela, agora. O texto é cortado em 1000, o teto do diário.
DO $$
DECLARE
  r RECORD;
  corpo TEXT;
  autor INTEGER;
BEGIN
  FOR r IN
    SELECT tp."teamId", tp."afterNotes", tp."lastSavedAt"
    FROM team_projects tp
    WHERE tp."afterNotes" IS NOT NULL AND btrim(tp."afterNotes") <> ''
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM posts p WHERE p."teamId" = r."teamId");
    SELECT m.id INTO autor
    FROM team_members tm JOIN members m ON m.username = tm.username
    WHERE tm."teamId" = r."teamId"
    ORDER BY m.id
    LIMIT 1;
    CONTINUE WHEN autor IS NULL;
    corpo := left(btrim(r."afterNotes"), 1000);
    INSERT INTO posts ("memberId", "body", "teamId", "createdAt")
    VALUES (autor, corpo, r."teamId", COALESCE(r."lastSavedAt", sqlite_now()));
  END LOOP;
END $$;
