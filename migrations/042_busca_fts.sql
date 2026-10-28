-- 042 — busca global (/busca e /api/search). Full-text do Postgres com o
-- dicionário 'portuguese' (existe no Postgres de produção e no PGlite dos
-- testes; sem extensão). Índice GIN de EXPRESSÃO: nada de coluna tsvector
-- nova pra manter em dia. Cada expressão aqui é a MESMA de lib/search.ts
-- (SEARCH_DOC), letra por letra — se divergir, o planner ignora o índice.
-- tests/api/busca.test.ts prova que cada consulta usa o índice.
-- Peso: A = nome/título, B = o que resume, C = texto longo.

CREATE INDEX IF NOT EXISTS idx_posts_fts ON posts USING GIN (
  (to_tsvector('portuguese', coalesce("body", '')))
);

CREATE INDEX IF NOT EXISTS idx_team_projects_fts ON team_projects USING GIN (
  (setweight(to_tsvector('portuguese', coalesce("title", '')), 'A')
   || setweight(to_tsvector('portuguese', coalesce("tagline", '') || ' ' || coalesce("technologies", '')), 'B')
   || setweight(to_tsvector('portuguese', coalesce("description", '')), 'C'))
);

CREATE INDEX IF NOT EXISTS idx_members_fts ON members USING GIN (
  (setweight(to_tsvector('portuguese', coalesce("name", '') || ' ' || coalesce("username", '')), 'A')
   || setweight(to_tsvector('portuguese', coalesce("headline", '')), 'B')
   || setweight(to_tsvector('portuguese', coalesce("bio", '')), 'C'))
);

CREATE INDEX IF NOT EXISTS idx_communities_fts ON communities USING GIN (
  (setweight(to_tsvector('portuguese', coalesce("name", '')), 'A')
   || setweight(to_tsvector('portuguese', coalesce("description", '')), 'B'))
);

CREATE INDEX IF NOT EXISTS idx_hackathons_fts ON hackathons USING GIN (
  (setweight(to_tsvector('portuguese', coalesce("name", '')), 'A')
   || setweight(to_tsvector('portuguese', coalesce("organizer", '')), 'B')
   || setweight(to_tsvector('portuguese', coalesce("description", '')), 'C'))
);

-- prefixo do @ (username ILIKE 'q%'): o UNIQUE de members.username é btree
-- com collation, não serve pra ILIKE; a lista de pessoas é pequena e o FTS
-- acima cobre o resto, então fica sem índice próprio por enquanto.
