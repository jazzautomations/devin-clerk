-- O seed antigo pôs dados que ninguém confirmou como se fossem "dado real
-- divulgado": o time campeão da edição de Sorocaba (One Day Hospital, "apresentada
-- na Oracle SP") e dois desafios com prêmio (R$5k em consultoria, visita ao
-- Oracle Innovation Center). O dono apontou como inventado (15/10/2026): sai.
-- Só apaga o time se ninguém de verdade estiver ligado a ele.
DELETE FROM team_projects
 WHERE "teamId" IN (
   SELECT t."id" FROM teams t
    WHERE t."hackathonId" = 'hack-inova-unifacens-2026' AND t."name" = 'One Day Hospital'
      AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m."teamId" = t."id"));
DELETE FROM teams t
 WHERE t."hackathonId" = 'hack-inova-unifacens-2026' AND t."name" = 'One Day Hospital'
   AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m."teamId" = t."id")
   AND NOT EXISTS (SELECT 1 FROM announcements a WHERE a."teamId" = t."id");
DELETE FROM challenges WHERE "id" IN ('seed-unifacens-ia-saude', 'seed-puc-jornada-paciente');
