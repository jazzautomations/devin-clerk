-- Radar Brasil-first.
-- region: br (presencial/híbrido no Brasil), online-br (online, organizador
-- brasileiro ou em português), online-mundo, exterior. NULL = o app deriva
-- do local/fonte (lib/radar.ts) até o scraper preencher.
-- excludedReason: por que o classificador tirou o evento do radar
-- (nao-hackathon, disciplina, premio-irrisorio...). A linha fica, só sai do ar.
ALTER TABLE hackathons ADD COLUMN "region" TEXT;
ALTER TABLE hackathons ADD COLUMN "excludedReason" TEXT;

-- Meetup entrava com nome neutro ("30º BitDevs BH", "Retrospectiva do
-- Grupo"). Agora só fica se o nome for de hackathon.
UPDATE hackathons SET "active" = 0, "excludedReason" = 'nao-hackathon'
WHERE "source" LIKE '%meetup%' AND "active" = 1
  AND "name" !~* '(hack|datathon|ideathon|buildathon|makeathon|designathon|game ?jam|codefest|maratona +(de +)?(programa|inova)|desafio +(de +)?inova|space +apps)';

-- Devpost de disciplina de faculdade ("2026-2027 Fall ESE Senior Design").
-- Prêmio irrisório e organizador vazio o scraper resolve na próxima rodada.
UPDATE hackathons SET "active" = 0, "excludedReason" = 'disciplina'
WHERE "source" LIKE '%devpost%' AND "active" = 1
  AND "name" ~* '(senior +design|capstone|\mcourse\M|\msemester\M|homework|\mESE\M)';
