import db from "@/lib/db";

// schema próprio (idempotente) — não edita lib/db.ts (pattern lib/deploys.ts)
db.exec(`CREATE TABLE IF NOT EXISTS looking_for_team (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memberId INTEGER NOT NULL REFERENCES members(id),
  hackathonId TEXT NOT NULL REFERENCES hackathons(id),
  skills TEXT NOT NULL DEFAULT '[]',
  need TEXT NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (memberId, hackathonId)
)`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_lft_hackathon ON looking_for_team(hackathonId, active)",
);

export type BoardEntry = {
  id: number;
  memberId: number;
  hackathonId: string;
  skills: string[];
  need: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  username: string;
  name: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
};

type Row = Omit<BoardEntry, "skills" | "active"> & {
  skills: string;
  active: number;
};

const select = `SELECT l.id, l.memberId, l.hackathonId, l.skills, l.need, l.note,
       l.active, l.createdAt,
       m.username, m.name, m.headline, m.persona, m.xp
       FROM looking_for_team l JOIN members m ON m.id = l.memberId`;

const toEntry = (r: Row): BoardEntry => ({
  ...r,
  skills: JSON.parse(r.skills),
  active: r.active === 1,
});

export const NEED_MAX = 200;
export const NOTE_MAX = 300;
export const SKILLS_MAX = 10;
export const SKILL_LEN = 30;

export type BoardInput = {
  skills: string[];
  need: string;
  note: string | null;
};

// valida o payload do POST: need é a essência do anúncio (o que falta no
// time); skills sanitiza (trim/dedup/limites) em vez de rejeitar
export function validateBoardInput(b: {
  skills?: unknown;
  need?: unknown;
  note?: unknown;
}): BoardInput {
  const need = typeof b.need === "string" ? b.need.trim() : "";
  if (!need || need.length > NEED_MAX) {
    throw new Error(`need obrigatório (1–${NEED_MAX} chars)`);
  }
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") throw new Error("note inválido");
    const n = b.note.trim();
    if (n.length > NOTE_MAX) throw new Error(`note longo demais (máx ${NOTE_MAX})`);
    note = n || null;
  }
  let skills: string[] = [];
  if (b.skills !== undefined && b.skills !== null) {
    if (!Array.isArray(b.skills)) throw new Error("skills deve ser array");
    skills = [
      ...new Set(
        b.skills
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.slice(0, SKILL_LEN)),
      ),
    ].slice(0, SKILLS_MAX);
  }
  return { skills, need, note };
}

// board público da edição — cronológico, só ativos (edição passada vira
// histórico: o dado fica, a UI decide se mostra o composer)
export function listBoardEntries(hackathonId: string): BoardEntry[] {
  return (
    db
      .prepare(
        `${select} WHERE l.hackathonId = ? AND l.active = 1
         ORDER BY l.createdAt ASC, l.id ASC`,
      )
      .all(hackathonId) as Row[]
  ).map(toEntry);
}

// visão admin: inclui inativos pra moderação (reativar entry escondida)
export function listAllBoardEntries(hackathonId: string): BoardEntry[] {
  return (
    db
      .prepare(
        `${select} WHERE l.hackathonId = ?
         ORDER BY l.active DESC, l.createdAt ASC, l.id ASC`,
      )
      .all(hackathonId) as Row[]
  ).map(toEntry);
}

export function countBoardEntries(hackathonId: string): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) n FROM looking_for_team WHERE hackathonId = ? AND active = 1",
      )
      .get(hackathonId) as { n: number }
  ).n;
}

// o anúncio do próprio membro — qualquer estado (pra saber se reativa)
export function getBoardEntry(
  memberId: number,
  hackathonId: string,
): BoardEntry | null {
  const r = db
    .prepare(`${select} WHERE l.memberId = ? AND l.hackathonId = ?`)
    .get(memberId, hackathonId) as Row | undefined;
  return r ? toEntry(r) : null;
}

export function getBoardEntryById(id: number): BoardEntry | null {
  const r = db.prepare(`${select} WHERE l.id = ?`).get(id) as Row | undefined;
  return r ? toEntry(r) : null;
}

// INSERT OR IGNORE: changes>0 = primeira vez (created → gate do XP);
// conflito = re-anúncio → atualiza campos e reativa
export function upsertBoardEntry(
  memberId: number,
  hackathonId: string,
  input: BoardInput,
): { entry: BoardEntry; created: boolean } {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO looking_for_team (memberId, hackathonId, skills, need, note, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .run(memberId, hackathonId, JSON.stringify(input.skills), input.need, input.note);
  const created = res.changes > 0;
  if (!created) {
    db.prepare(
      `UPDATE looking_for_team SET skills = ?, need = ?, note = ?, active = 1
       WHERE memberId = ? AND hackathonId = ?`,
    ).run(
      JSON.stringify(input.skills),
      input.need,
      input.note,
      memberId,
      hackathonId,
    );
  }
  return { entry: getBoardEntry(memberId, hackathonId)!, created };
}

// time formado → o membro desativa; idempotente (sem entry não é erro)
export function deactivateBoardEntry(
  memberId: number,
  hackathonId: string,
): void {
  db.prepare(
    "UPDATE looking_for_team SET active = 0 WHERE memberId = ? AND hackathonId = ?",
  ).run(memberId, hackathonId);
}

// moderação admin — liga/desliga por id (entry abusiva esconde, não apaga)
export function setBoardEntryActive(
  entryId: number,
  active: boolean,
): BoardEntry | null {
  const res = db
    .prepare("UPDATE looking_for_team SET active = ? WHERE id = ?")
    .run(active ? 1 : 0, entryId);
  if (res.changes === 0) return null;
  return getBoardEntryById(entryId);
}
