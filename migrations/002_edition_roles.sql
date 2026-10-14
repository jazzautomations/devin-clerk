-- 002 — papéis por edição (spec 033 US7). Admin global continua em
-- members.role; aqui é quem opera UMA edição: organizador, staff (check-in),
-- mentor, jurado. Convite por e-mail fica pendente até a pessoa entrar.

CREATE TABLE edition_roles (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id"),
  "memberId" INTEGER NOT NULL REFERENCES members("id"),
  "role" TEXT NOT NULL CHECK ("role" IN ('organizador','staff','mentor','jurado')),
  "grantedBy" INTEGER REFERENCES members("id"),
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "memberId", "role")
);
CREATE INDEX idx_edition_roles_member ON edition_roles ("memberId");

CREATE TABLE edition_role_invites (
  "hackathonId" TEXT NOT NULL REFERENCES hackathons("id"),
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('organizador','staff','mentor','jurado')),
  "invitedBy" INTEGER REFERENCES members("id"),
  "createdAt" TEXT NOT NULL DEFAULT sqlite_now(),
  PRIMARY KEY ("hackathonId", "email", "role")
);
CREATE INDEX idx_edition_role_invites_email ON edition_role_invites ("email");
