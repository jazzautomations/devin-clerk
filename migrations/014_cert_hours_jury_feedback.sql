-- 014 — certificado com carga horária (roadmap 037 #2) e feedback do júri
-- pro time (roadmap 037 #9).
--
-- Carga horária: a organização define horas por papel na edição; NULL =
-- default calculado pela duração da edição. O certificado CONGELA papel,
-- horas, período e instituição na emissão — mudar a configuração depois não
-- reescreve certificado já emitido (quem lançou hora complementar com ele
-- não pode ver o número mudar). Certificado emitido antes desta migration
-- fica com essas colunas NULL e segue válido como estava.
--
-- Curso/instituição/matrícula do aluno não são colunas fixas: o formulário
-- de inscrição é livre, então a organização aponta qual pergunta é qual
-- (ou o sistema acha pelo texto da pergunta) pro CSV de hora complementar.

CREATE TABLE certificate_settings (
  "hackathonId" TEXT PRIMARY KEY REFERENCES hackathons("id") ON DELETE CASCADE,
  "hoursParticipante" INTEGER CHECK ("hoursParticipante" IS NULL OR "hoursParticipante" BETWEEN 1 AND 1000),
  "hoursStaff" INTEGER CHECK ("hoursStaff" IS NULL OR "hoursStaff" BETWEEN 1 AND 1000),
  "hoursMentor" INTEGER CHECK ("hoursMentor" IS NULL OR "hoursMentor" BETWEEN 1 AND 1000),
  "hoursJurado" INTEGER CHECK ("hoursJurado" IS NULL OR "hoursJurado" BETWEEN 1 AND 1000),
  "hoursOrganizador" INTEGER CHECK ("hoursOrganizador" IS NULL OR "hoursOrganizador" BETWEEN 1 AND 1000),
  -- presença mínima do participante: check-in sempre; com isto, também
  -- precisa ter entrega do time enviada até a trava
  "requireLockedEntry" INTEGER NOT NULL DEFAULT 0,
  -- instituição promotora impressa no certificado; NULL = hackathons.organizer
  "institution" TEXT,
  "courseQuestionId" INTEGER REFERENCES edition_questions("id") ON DELETE SET NULL,
  "institutionQuestionId" INTEGER REFERENCES edition_questions("id") ON DELETE SET NULL,
  "enrollmentQuestionId" INTEGER REFERENCES edition_questions("id") ON DELETE SET NULL,
  "updatedAt" TEXT NOT NULL DEFAULT sqlite_now()
);

ALTER TABLE certificates ADD COLUMN "role" TEXT
  CHECK ("role" IS NULL OR "role" IN ('participante', 'staff', 'mentor', 'jurado', 'organizador'));
ALTER TABLE certificates ADD COLUMN "hours" INTEGER;
ALTER TABLE certificates ADD COLUMN "periodStart" TEXT;
ALTER TABLE certificates ADD COLUMN "periodEnd" TEXT;
ALTER TABLE certificates ADD COLUMN "institution" TEXT;

-- feedback do júri PRO TIME. scores.comment continua sendo a nota interna
-- do jurado pra organização (foi escrita sem o time ler; não vaza).
-- scores.feedback = comentário por critério; jury_team_feedback = geral.
ALTER TABLE scores ADD COLUMN "feedback" TEXT;

CREATE TABLE jury_team_feedback (
  "judgeMemberId" INTEGER NOT NULL REFERENCES members("id"),
  "teamId" INTEGER NOT NULL REFERENCES teams("id") ON DELETE CASCADE,
  "comment" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("judgeMemberId", "teamId")
);
CREATE INDEX idx_jury_team_feedback_team ON jury_team_feedback ("teamId");

-- a organização libera (e pode recolher) o feedback; só aparece pro time
-- com resultado publicado E liberação ligada
ALTER TABLE hackathons ADD COLUMN "juryFeedbackReleased" INTEGER NOT NULL DEFAULT 0;
