-- 021 — resultado do júri congelado e certificado revogável (auditoria 041,
-- pacote D).
--
-- jury_results guarda o ranking do momento da publicação: depois de
-- publicado, quem lê o resultado lê esse snapshot, e o pódio não muda por
-- baixo (jurado removido, time que saiu, exclusão de conta). `forced` e
-- `reason` registram quando a organização publicou com avaliação faltando.
--
-- certificates.revokedAt: premiação de quem saiu do pódio numa
-- republicação fica revogada (o link /c/<código> continua abrindo e diz
-- "revogado"). Texto de certificado emitido não muda mais: muda o detalhe,
-- nasce um código novo e o antigo é revogado. Por isso a unicidade por
-- (membro, edição, tipo, categoria) passa a valer só entre os vigentes.

ALTER TABLE jury_results ADD COLUMN "ranking" JSONB;
ALTER TABLE jury_results ADD COLUMN "forced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jury_results ADD COLUMN "reason" TEXT;

ALTER TABLE certificates ADD COLUMN "revokedAt" TEXT;

DROP INDEX IF EXISTS idx_certificates_unique_kind;
CREATE UNIQUE INDEX idx_certificates_unique_kind ON certificates
  ("memberId", "hackathonId", "kind", (COALESCE("prizeCategoryId", 0)))
  WHERE "revokedAt" IS NULL;
