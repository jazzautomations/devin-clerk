-- 019 — datas da edição sempre no horário de Brasília (auditoria 041, pacote B).
--
-- O <input type="datetime-local"> manda "2026-11-28T09:00", sem fuso. O
-- to_ts antigo lia isso como UTC (3h adiantado), e o formulário de editar
-- cortava o "-03:00" das datas do seed ao salvar. Regra nova, igual ao
-- parser do app (lib/eventTime.ts):
--   "2026-11-14"                → 09:00 em Brasília
--   "2026-11-14T09:00[:00]"     → horário de parede em Brasília
--   "...Z" / "...-03:00"        → o instante exato
--   "2026-11-14 12:00:00"       → UTC (timestamps do sistema: createdAt etc.)
CREATE OR REPLACE FUNCTION to_ts(v text) RETURNS timestamptz
  LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN (v || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  IF v ~ '(Z|z|[+-]\d\d:?\d\d)$' THEN RETURN v::timestamptz; END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}T' THEN
    RETURN v::timestamp AT TIME ZONE 'America/Sao_Paulo';
  END IF;
  RETURN (v || ' UTC')::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- linhas que já perderam o fuso (salvas pelo formulário): o valor digitado
-- era horário de Brasília. Idempotente: depois do UPDATE o texto tem offset
-- e não casa mais com o padrão.
UPDATE hackathons SET "startsAt" = "startsAt" || '-03:00'
  WHERE "startsAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$';
UPDATE hackathons SET "endsAt" = "endsAt" || '-03:00'
  WHERE "endsAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$';
UPDATE hackathons SET "registrationDeadline" = "registrationDeadline" || '-03:00'
  WHERE "registrationDeadline" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$';

-- o seed (lib/seed.ts) passa a gravar source = 'seed' e só aposenta linhas
-- dele. As edições do seed que já existem ganham a marca aqui.
UPDATE hackathons SET "source" = 'seed'
  WHERE "source" IS NULL
    AND "id" IN ('hack-inova-alphaville-2026', 'hack-inova-unifacens-2026',
                 'hack-inova-puc-saude-2026', 'hackinova-os-2-anhembi-2026');

-- check-in fora da janela do evento (véspera até 2 dias depois do fim) só
-- com o admin global forçando; fica marcado aqui.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS "outsideWindow" INTEGER NOT NULL DEFAULT 0;

-- rascunho e arquivada eram o mesmo estado (active = 0), e o organizador
-- conseguia publicar de novo uma edição que o admin global tirou do ar.
-- "publishedAt" marca a primeira vez que a edição ficou no ar: com ela
-- preenchida, voltar pro ar é só com o admin global. O gatilho cobre todo
-- caminho que põe active = 1 (painel, seed, curadoria, radar).
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "publishedAt" TEXT;
UPDATE hackathons SET "publishedAt" = sqlite_now()
  WHERE "active" = 1 AND "publishedAt" IS NULL;

CREATE OR REPLACE FUNCTION hackathons_mark_published() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active" = 1 AND NEW."publishedAt" IS NULL THEN
    NEW."publishedAt" := sqlite_now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hackathons_mark_published ON hackathons;
CREATE TRIGGER hackathons_mark_published
  BEFORE INSERT OR UPDATE OF "active" ON hackathons
  FOR EACH ROW EXECUTE FUNCTION hackathons_mark_published();
