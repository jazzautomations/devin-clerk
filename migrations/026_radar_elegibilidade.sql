-- Radar global: o que a pessoa precisa saber pra decidir se entra.
-- scope: alcance do evento. global | brasil | latam | pais | cidade.
--   NULL = o app deriva da região (lib/radar.ts radarScope).
-- country: país do evento (pais/cidade), em português ("EUA", "Índia").
-- brazilOk: brasileiro pode participar? 'sim' | 'nao'; NULL = não informado.
--   Só vira 'sim'/'nao' com evidência: regra de elegibilidade da fonte ou
--   evento que acontece no Brasil. Sem evidência fica NULL.
-- eligibilityNote: o trecho da regra que decidiu (ou o motivo), curto.
-- eligibilityUrl: onde a regra está (página de regras da fonte).
-- eligibilityCheckedAt: quando o scraper leu a regra (cache entre rodadas).
-- prizeUsd: prêmio total aproximado em dólar, só pra ordenar e filtrar.
--   A tela mostra o prêmio na moeda original (coluna prize).
-- submissionDeadline: prazo de entrega do projeto (registrationDeadline
--   continua sendo o prazo de inscrição).
-- brand: marca grande por trás do evento (NASA, Meta, NVIDIA…), quando dá.
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "scope" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "brazilOk" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "eligibilityNote" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "eligibilityUrl" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "eligibilityCheckedAt" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "prizeUsd" INTEGER;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "submissionDeadline" TEXT;
ALTER TABLE hackathons ADD COLUMN IF NOT EXISTS "brand" TEXT;
