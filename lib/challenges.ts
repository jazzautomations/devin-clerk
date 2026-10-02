import { randomUUID } from "node:crypto";
import db from "@/lib/db";

export type Challenge = {
  id: string;
  hackathonId: string;
  sponsor: string; // a marca que paga — o inventário vendido
  title: string;
  description: string | null;
  prize: string | null;
  active: boolean;
  createdAt: string;
};

type Row = Omit<Challenge, "active"> & { active: number };

function toChallenge(row: Row): Challenge {
  return { ...row, active: row.active === 1 };
}

// listagem pública: só ativos — desativado fica no banco (histórico/contrato)
export function getChallenges(hackathonId: string): Challenge[] {
  const rows = db
    .prepare(
      `SELECT id, hackathonId, sponsor, title, description, prize, active, createdAt
       FROM challenges WHERE hackathonId = ? AND active = 1
       ORDER BY createdAt, rowid`,
    )
    .all(hackathonId) as Row[];
  return rows.map(toChallenge);
}

// inclui inativos — uso admin
export function listChallenges(hackathonId: string): Challenge[] {
  const rows = db
    .prepare(
      `SELECT id, hackathonId, sponsor, title, description, prize, active, createdAt
       FROM challenges WHERE hackathonId = ?
       ORDER BY createdAt, rowid`,
    )
    .all(hackathonId) as Row[];
  return rows.map(toChallenge);
}

export function getChallenge(id: string): Challenge | null {
  const row = db
    .prepare(
      `SELECT id, hackathonId, sponsor, title, description, prize, active, createdAt
       FROM challenges WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  return row ? toChallenge(row) : null;
}

export function createChallenge(
  hackathonId: string,
  input: {
    sponsor: string;
    title: string;
    description?: string | null;
    prize?: string | null;
  },
): Challenge {
  const sponsor = input.sponsor?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  if (!sponsor) throw new Error("sponsor obrigatório — é a marca que paga");
  if (!title) throw new Error("title obrigatório");
  const id = `chal-${randomUUID()}`;
  db.prepare(
    `INSERT INTO challenges (id, hackathonId, sponsor, title, description, prize)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    hackathonId,
    sponsor,
    title,
    input.description?.trim() || null,
    input.prize?.trim() || null,
  );
  return getChallenge(id)!;
}

export type ChallengePatch = {
  sponsor?: string;
  title?: string;
  description?: string | null;
  prize?: string | null;
  active?: boolean;
};

// update parcial: só os campos presentes são tocados; null limpa o campo
export function updateChallenge(
  id: string,
  patch: ChallengePatch,
): Challenge | null {
  if (!getChallenge(id)) return null;

  const sets: string[] = [];
  const values: Record<string, unknown> = { id };

  if (patch.sponsor !== undefined) {
    sets.push("sponsor = @sponsor");
    values.sponsor = patch.sponsor.trim();
  }
  if (patch.title !== undefined) {
    sets.push("title = @title");
    values.title = patch.title.trim();
  }
  if (patch.description !== undefined) {
    sets.push("description = @description");
    values.description =
      typeof patch.description === "string" && patch.description.trim()
        ? patch.description.trim()
        : null;
  }
  if (patch.prize !== undefined) {
    sets.push("prize = @prize");
    values.prize =
      typeof patch.prize === "string" && patch.prize.trim()
        ? patch.prize.trim()
        : null;
  }
  if (patch.active !== undefined) {
    sets.push("active = @active");
    values.active = patch.active ? 1 : 0;
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE challenges SET ${sets.join(", ")} WHERE id = @id`).run(
      values,
    );
  }
  return getChallenge(id);
}
