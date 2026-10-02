import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { hackathons as seed, pastHackathons as pastSeed } from "@/data/hackathons";

const dir = join(process.cwd(), "data");
const dbPath = process.env.HACKAHUB_DB ?? join(dir, "hackahub.db");
if (dbPath !== ":memory:") mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS hackathons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organizer TEXT NOT NULL,
  startsAt TEXT NOT NULL,
  endsAt TEXT,
  format TEXT NOT NULL CHECK (format IN ('online','presencial','hibrido')),
  location TEXT,
  registrationUrl TEXT NOT NULL,
  registrationDeadline TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerkId TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  bio TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  github TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memberId INTEGER NOT NULL REFERENCES members(id),
  hackathonId TEXT NOT NULL REFERENCES hackathons(id),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (memberId, hackathonId)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memberId INTEGER NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  link TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  postId INTEGER NOT NULL REFERENCES posts(id),
  memberId INTEGER NOT NULL REFERENCES members(id),
  PRIMARY KEY (postId, memberId)
);

CREATE TABLE IF NOT EXISTS member_badges (
  memberId INTEGER NOT NULL REFERENCES members(id),
  badgeId TEXT NOT NULL,
  awardedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memberId, badgeId)
);

CREATE TABLE IF NOT EXISTS cards (
  hackathonId TEXT PRIMARY KEY REFERENCES hackathons(id),
  rarity TEXT NOT NULL DEFAULT 'comum'
    CHECK (rarity IN ('comum','raro','epico','lendario'))
);

CREATE TABLE IF NOT EXISTS member_cards (
  memberId INTEGER NOT NULL REFERENCES members(id),
  hackathonId TEXT NOT NULL REFERENCES cards(hackathonId),
  serial INTEGER NOT NULL,
  awardedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (memberId, hackathonId)
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hackathonId TEXT NOT NULL REFERENCES hackathons(id),
  name TEXT NOT NULL,
  placement INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (hackathonId, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  teamId INTEGER NOT NULL REFERENCES teams(id),
  username TEXT NOT NULL,
  PRIMARY KEY (teamId, username)
);

CREATE TABLE IF NOT EXISTS team_projects (
  teamId INTEGER PRIMARY KEY REFERENCES teams(id),
  title TEXT NOT NULL,
  description TEXT,
  repoUrl TEXT,
  demoUrl TEXT
);

CREATE TABLE IF NOT EXISTS edition_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hackathonId TEXT NOT NULL REFERENCES hackathons(id),
  type TEXT NOT NULL CHECK (type IN ('foto','slide','material')),
  url TEXT NOT NULL,
  caption TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  hackathonId TEXT NOT NULL REFERENCES hackathons(id),
  sponsor TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  prize TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId INTEGER NOT NULL REFERENCES posts(id),
  memberId INTEGER NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// migrações leves — ALTER TABLE idempotente pra bancos já existentes.
// ensureColumn é race-safe: `next build` coleta page-data em workers
// paralelos e libs irmãs guardam as mesmas colunas — dois workers podem
// ler o PRAGMA antes do ALTER um do outro. "duplicate column" aqui é
// idempotência, não erro (SQLite não tem ADD COLUMN IF NOT EXISTS).
export function ensureColumn(table: string, column: string, ddl: string) {
  const cols = (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((c) => c.name);
  if (cols.includes(column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (e) {
    if (!(e instanceof Error && /duplicate column name/i.test(e.message))) {
      throw e;
    }
  }
}

const memberCols = (
  db.prepare("PRAGMA table_info(members)").all() as { name: string }[]
).map((c) => c.name);
for (const col of ["linkedin", "twitter", "website", "headline", "persona"]) {
  ensureColumn("members", col, `${col} TEXT`);
}
if (!memberCols.includes("role")) {
  ensureColumn("members", "role", "role TEXT NOT NULL DEFAULT 'member'");
  // primeiro membro da plataforma é admin (bootstrap da operação)
  db.exec(`UPDATE members SET role = 'admin' WHERE id = 1`);
}
ensureColumn("hackathons", "source", "source TEXT");
// display string da fonte/curadoria ("$138,000", "R$ 5 mil") — spec 024
ensureColumn("hackathons", "prize", "prize TEXT");
// first_seen/last_seen são gravados pelo scraper (spec 005), mas a coluna
// precisa existir em banco que nunca rodou scrape — o momentum "+N · 30d"
// da landing conta por first_seen (spec 027). Sem backfill aqui: NULL =
// "não sabemos quando entrou", e o scraper preenche quando roda.
ensureColumn("hackathons", "first_seen", "first_seen TEXT");
ensureColumn("hackathons", "last_seen", "last_seen TEXT");
ensureColumn("posts", "link", "link TEXT");
ensureColumn("members", "xp", "xp INTEGER NOT NULL DEFAULT 0");

const insert = db.prepare(`
  INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline, tags, active, prize)
  VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location, @registrationUrl, @registrationDeadline, @tags, @active, @prize)
`);
const backfillPrize = db.prepare(
  // OR IGNORE não alcança bancos existentes — preenche só o vazio,
  // nunca sobrescreve prêmio posto à mão pelo admin
  "UPDATE hackathons SET prize = @prize WHERE id = @id AND prize IS NULL",
);
const seedAll = db.transaction(() => {
  for (const h of [...seed, ...pastSeed]) {
    insert.run({
      ...h,
      endsAt: h.endsAt ?? null,
      location: h.location ?? null,
      registrationDeadline: h.registrationDeadline ?? null,
      tags: JSON.stringify(h.tags),
      active: h.active ? 1 : 0,
      prize: h.prize ?? null,
    });
    if (h.prize) backfillPrize.run({ id: h.id, prize: h.prize });
  }
});
seedAll();

const seedIds = [...seed, ...pastSeed].map((h) => h.id);
db.prepare(
  `UPDATE hackathons SET active = 0
   WHERE source IS NULL
     AND id NOT IN (SELECT value FROM json_each(?))
     AND id NOT IN (SELECT hackathonId FROM registrations)`,
).run(JSON.stringify(seedIds));

// card colecionável por edição — raridade das edições Hack Inova é curadoria;
// eventos raspados mintam 'comum' sob demanda no register
const cardRarity: Record<string, string> = {
  "hack-inova-unifacens-2026": "lendario", // a 1ª edição — peça de arquivo
  "hack-inova-puc-saude-2026": "epico",
  "hackinova-os-2-anhembi-2026": "epico",
  "hack-inova-alphaville-2026": "raro",
};
const seedCard = db.prepare(
  "INSERT OR IGNORE INTO cards (hackathonId, rarity) VALUES (?, ?)",
);
for (const id of seedIds) {
  seedCard.run(id, cardRarity[id] ?? "comum");
}

// seed do arquivo: pódio público da Unifacens (dado real divulgado);
// o resto entra pelo admin quando os organizadores cadastrarem
const seedTeams = db.transaction(() => {
  db.prepare(
    `INSERT OR IGNORE INTO teams (hackathonId, name, placement)
     VALUES ('hack-inova-unifacens-2026', 'One Day Hospital', 1)`,
  ).run();
  const team = db
    .prepare(
      "SELECT id FROM teams WHERE hackathonId = ? AND name = ?",
    )
    .get("hack-inova-unifacens-2026", "One Day Hospital") as
    | { id: number }
    | undefined;
  if (team) {
    db.prepare(
      `INSERT OR IGNORE INTO team_projects (teamId, title, description)
       VALUES (?, ?, ?)`,
    ).run(
      team.id,
      "One Day Hospital",
      "Vencedora da 1ª edição — solução de saúde apresentada depois na Oracle SP",
    );
  }
});
seedTeams();

// desafios patrocinados — o inventário de monetização (participante nunca
// paga; quem paga é a marca que lança o desafio). seeds = patrocínio real
// divulgado das edições; o resto entra pelo admin
const seedChallenge = db.prepare(
  `INSERT OR IGNORE INTO challenges (id, hackathonId, sponsor, title, description, prize)
   VALUES (@id, @hackathonId, @sponsor, @title, @description, @prize)`,
);
const seedChallenges = db.transaction(() => {
  seedChallenge.run({
    id: "seed-puc-jornada-paciente",
    hackathonId: "hack-inova-puc-saude-2026",
    sponsor: "Oracle",
    title: "Jornada do paciente",
    description:
      "A edição rodou 7 desafios da jornada do paciente — do agendamento ao pós-consulta — com contexto e dados da Oracle.",
    prize: "créditos OCI + visita Oracle Innovation Center",
  });
  seedChallenge.run({
    id: "seed-unifacens-ia-saude",
    hackathonId: "hack-inova-unifacens-2026",
    sponsor: "Oracle + Enterprise X Ventures",
    title: "IA aplicada à saúde",
    description:
      "Desafio aberto de IA pra saúde na 1ª edição — o projeto vencedor (One Day Hospital) foi apresentado depois na Oracle SP.",
    prize: "R$5k em consultoria + créditos OCI",
  });
});
seedChallenges();

export default db;
