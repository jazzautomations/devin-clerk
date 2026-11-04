-- 054 — liga do semestre por faixa (spec 046, onda 5: liga-por-faixa).
--
-- A liga é a comparação entre edições SEM placar geral: mostra faixa
-- ("top 25%") e nunca posição numérica, e a lista de nomes só existe pra quem
-- ativou o opt-in. Entra desligada (HACKAHUB_LIGA_ON): o fundador liga depois
-- de conversar com 5 organizadores (spec 040 #21).
--
-- "leagueOptIn" é o opt-in da lista (padrão 0: ninguém aparece pra outra
-- pessoa sem escolher). Registrado em ANONYMIZE (lib/privacy.ts) com 0: conta
-- excluída sai da lista da liga junto com o resto do perfil.
--
-- Os pontos NÃO moram aqui: saem dos fatos de lib/evidence.ts na leitura
-- (lib/league.ts), com o mesmo recorte de edição elegível. Sem tabela nova de
-- placar, sem contador que descola do registro.
ALTER TABLE members ADD COLUMN IF NOT EXISTS "leagueOptIn" INTEGER NOT NULL DEFAULT 0
  CHECK ("leagueOptIn" IN (0, 1));
