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
`);

// migrações leves — ALTER TABLE idempotente pra bancos já existentes
const memberCols = (
  db.prepare("PRAGMA table_info(members)").all() as { name: string }[]
).map((c) => c.name);
for (const col of ["linkedin", "twitter", "website", "headline", "persona"]) {
  if (!memberCols.includes(col)) {
    db.exec(`ALTER TABLE members ADD COLUMN ${col} TEXT`);
  }
}
if (!memberCols.includes("role")) {
  db.exec(`ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`);
  // primeiro membro da plataforma é admin (bootstrap da operação)
  db.exec(`UPDATE members SET role = 'admin' WHERE id = 1`);
}
const hackCols = (
  db.prepare("PRAGMA table_info(hackathons)").all() as { name: string }[]
).map((c) => c.name);
if (!hackCols.includes("source")) {
  db.exec(`ALTER TABLE hackathons ADD COLUMN source TEXT`);
}
const postCols = (
  db.prepare("PRAGMA table_info(posts)").all() as { name: string }[]
).map((c) => c.name);
if (!postCols.includes("link")) {
  db.exec(`ALTER TABLE posts ADD COLUMN link TEXT`);
}
if (!memberCols.includes("xp")) {
  db.exec(`ALTER TABLE members ADD COLUMN xp INTEGER NOT NULL DEFAULT 0`);
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline, tags, active)
  VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location, @registrationUrl, @registrationDeadline, @tags, @active)
`);
const seedAll = db.transaction(() => {
  for (const h of [...seed, ...pastSeed]) {
    insert.run({
      ...h,
      endsAt: h.endsAt ?? null,
      location: h.location ?? null,
      registrationDeadline: h.registrationDeadline ?? null,
      tags: JSON.stringify(h.tags),
      active: h.active ? 1 : 0,
    });
  }
});
seedAll();

const seedIds = [...seed, ...pastSeed].map((h) => h.id);
db.prepare(
  `UPDATE hackathons SET active = 0
   WHERE id NOT IN (SELECT value FROM json_each(?))
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

export default db;
