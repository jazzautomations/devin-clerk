-- 008 — quem a pessoa é no ecossistema, múltiplo (dev E founder, mentor E
-- investidor…). "persona" continua sendo o principal (1º da lista) porque
-- feed/comentários/talento já mostram ele.
ALTER TABLE members ADD COLUMN "personas" TEXT NOT NULL DEFAULT '[]';
UPDATE members SET "personas" = json_build_array("persona")::text
 WHERE "persona" IS NOT NULL AND "persona" <> '';
