-- 029 — dossiê de evidência do projeto (roadmap 037 #10, pesquisa 036 #2).
-- Quando o time informa um repositório público do GitHub, o HackaHub lê os
-- commits e guarda uma foto da linha do tempo, pra organização comparar com
-- a janela do evento. O dossiê só sinaliza: ninguém é desclassificado nem
-- perde nota por ele.

-- declaração do time na entrega. NULL = não respondeu. "O quê" fica no
-- priorWork e "como" no aiUsage, que já existem (migration 010).
ALTER TABLE team_projects ADD COLUMN IF NOT EXISTS "priorExisted" INTEGER;
ALTER TABLE team_projects ADD COLUMN IF NOT EXISTS "usedAi" INTEGER;

-- uma linha por time: a última foto do repositório.
--   commits: JSON [{sha, date, author, message}] — date em UTC
--            "YYYY-MM-DD HH:MM:SS" (data de autoria do git), mais novo primeiro.
--            Até 300: os 200 mais novos + os 100 mais antigos quando o
--            repositório tem mais que isso (truncated = 1).
--   totalCommits: total no branch padrão (estimado pela paginação).
--   collectedAt: última coleta que deu certo; attemptedAt: última tentativa.
--   errorKind/errorMessage: motivo da última tentativa que falhou (NULL = ok).
--   collectedBy: quem clicou "atualizar"; NULL = coleta automática no envio.
CREATE TABLE IF NOT EXISTS project_dossiers (
  "teamId" INTEGER PRIMARY KEY REFERENCES teams("id") ON DELETE CASCADE,
  "repoUrl" TEXT NOT NULL,
  "repoFullName" TEXT,
  "repoCreatedAt" TEXT,
  "repoPushedAt" TEXT,
  "forkOf" TEXT,
  "defaultBranch" TEXT,
  "totalCommits" INTEGER NOT NULL DEFAULT 0,
  "truncated" INTEGER NOT NULL DEFAULT 0,
  "commits" TEXT NOT NULL DEFAULT '[]',
  "collectedAt" TEXT,
  "attemptedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  "errorKind" TEXT CHECK ("errorKind" IN ('invalid', 'not_found', 'private', 'rate_limited', 'empty', 'network', 'error')),
  "errorMessage" TEXT,
  "collectedBy" INTEGER REFERENCES members("id")
);
