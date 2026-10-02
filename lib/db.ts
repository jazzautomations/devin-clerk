import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { hackathons as seed, pastHackathons as pastSeed } from "@/data/hackathons";

const dir = join(process.cwd(), "data");
mkdirSync(dir, { recursive: true });

const db = new Database(join(dir, "hackahub.db"));
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
`);

// migrações leves — ALTER TABLE idempotente pra bancos já existentes
const memberCols = (
  db.prepare("PRAGMA table_info(members)").all() as { name: string }[]
).map((c) => c.name);
for (const col of ["linkedin", "twitter", "website", "headline"]) {
  if (!memberCols.includes(col)) {
    db.exec(`ALTER TABLE members ADD COLUMN ${col} TEXT`);
  }
}
if (!memberCols.includes("role")) {
  db.exec(`ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`);
  // primeiro membro da plataforma é admin (bootstrap da operação)
  db.exec(`UPDATE members SET role = 'admin' WHERE id = 1`);
}
const postCols = (
  db.prepare("PRAGMA table_info(posts)").all() as { name: string }[]
).map((c) => c.name);
if (!postCols.includes("link")) {
  db.exec(`ALTER TABLE posts ADD COLUMN link TEXT`);
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

export default db;
