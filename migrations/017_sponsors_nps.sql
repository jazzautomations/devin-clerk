-- 017 — o que vende pra patrocinador (roadmap 037 #8, #11, #12; frente O).
--
-- (1) Patrocinadores DA EDIÇÃO. A marca continua sendo a entidade global
-- `sponsors` (spec 019: nome único, desafios apontam pra ela via
-- challenges.sponsorId). O que muda de edição pra edição — nível, logo, site
-- usado na página — fica em edition_sponsors. O organizador cadastra pelo
-- nome: se a marca já existe, reaproveita; senão cria.
CREATE TABLE edition_sponsors (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id") ON DELETE CASCADE,
  "sponsorId" TEXT NOT NULL REFERENCES sponsors("id") ON DELETE CASCADE,
  "tier" TEXT NOT NULL DEFAULT 'sponsor' CHECK ("tier" IN ('apoio', 'sponsor', 'master')),
  "logoUrl" TEXT,
  "url" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdBy" INTEGER REFERENCES members("id") ON DELETE SET NULL,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "sponsorId")
);

-- categoria GERAL também pode ser "oferecida por" um patrocinador; a de
-- desafio segue o patrocinador do desafio (não precisa da coluna)
ALTER TABLE prize_categories ADD COLUMN "sponsorId" TEXT REFERENCES sponsors("id") ON DELETE SET NULL;

-- Papel "patrocinador" escopado por (edição, patrocinador). Tabela própria e
-- não edition_roles: lá o papel vale pela edição inteira (e organizador vale
-- por todos); aqui quem é da marca A nunca enxerga a B, então o sponsorId
-- precisa estar na chave. Convite por e-mail espelha edition_role_invites.
CREATE TABLE edition_sponsor_members (
  "hackathonId" TEXT NOT NULL,
  "sponsorId" TEXT NOT NULL,
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "grantedBy" INTEGER REFERENCES members("id") ON DELETE SET NULL,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "sponsorId", "memberId"),
  FOREIGN KEY ("hackathonId", "sponsorId")
    REFERENCES edition_sponsors ("hackathonId", "sponsorId") ON DELETE CASCADE
);
CREATE INDEX idx_edition_sponsor_members_member ON edition_sponsor_members ("memberId");

CREATE TABLE edition_sponsor_invites (
  "hackathonId" TEXT NOT NULL,
  "sponsorId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "invitedBy" INTEGER REFERENCES members("id") ON DELETE SET NULL,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "sponsorId", "email"),
  FOREIGN KEY ("hackathonId", "sponsorId")
    REFERENCES edition_sponsors ("hackathonId", "sponsorId") ON DELETE CASCADE
);
CREATE INDEX idx_edition_sponsor_invites_email ON edition_sponsor_invites ("email");

-- (2) Opt-in de contato por QR. Uma linha por (edição, patrocinador, pessoa):
-- grantedAt registra o aceite, revokedAt a revogação (a linha fica como
-- registro, mas o relatório só lê revokedAt IS NULL). Nenhum dado de contato
-- é copiado: o relatório lê do perfil na hora, então revogar ou excluir a
-- conta tira o contato na hora. "fields" guarda o que foi mostrado no aceite.
CREATE TABLE sponsor_contact_optins (
  "hackathonId" TEXT NOT NULL,
  "sponsorId" TEXT NOT NULL,
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "fields" TEXT NOT NULL DEFAULT '[]',
  "grantedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  "revokedAt" TEXT,
  PRIMARY KEY ("hackathonId", "sponsorId", "memberId"),
  FOREIGN KEY ("hackathonId", "sponsorId")
    REFERENCES edition_sponsors ("hackathonId", "sponsorId") ON DELETE CASCADE
);
CREATE INDEX idx_sponsor_contact_optins_active
  ON sponsor_contact_optins ("hackathonId", "sponsorId") WHERE "revokedAt" IS NULL;

-- (3) NPS por papel, só pra quem esteve lá. npsClosesAt NULL = fim da
-- edição + 7 dias. nps_invites: a PK é a idempotência do disparo (o cron
-- pode rodar à vontade, cada pessoa recebe a pesquisa uma vez).
-- nps_responses: uma por pessoa por edição (PK); memberId existe SÓ pra
-- deduplicar/editar — painel e relatório nunca leem.
ALTER TABLE hackathons ADD COLUMN "npsClosesAt" TEXT;

CREATE TABLE nps_invites (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id") ON DELETE CASCADE,
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('participante', 'staff', 'mentor', 'jurado', 'patrocinador')),
  "announcementId" INTEGER REFERENCES announcements("id") ON DELETE SET NULL,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "memberId")
);

CREATE TABLE nps_responses (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id") ON DELETE CASCADE,
  "memberId" INTEGER NOT NULL REFERENCES members("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('participante', 'staff', 'mentor', 'jurado', 'patrocinador')),
  "score" INTEGER NOT NULL CHECK ("score" BETWEEN 0 AND 10),
  "worked" TEXT,
  "improve" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  "updatedAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "memberId")
);
CREATE INDEX idx_nps_responses_role ON nps_responses ("hackathonId", "role");
