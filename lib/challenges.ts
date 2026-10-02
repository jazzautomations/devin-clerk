import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { getSponsor, type SponsorTier } from "@/lib/sponsors";

export type Challenge = {
  id: string;
  hackathonId: string;
  sponsor: string; // nome de exibição — fallback quando não há entidade
  sponsorId: string | null; // vínculo com a entidade sponsors (spec 019)
  sponsorUrl: string | null; // do join — fresquinho mesmo se a marca mudar
  sponsorTier: SponsorTier | null;
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

// join na leitura (não cópia): sponsorUrl/sponsorTier seguem a entidade;
// sponsor TEXT é o nome de exibição sempre presente
const SELECT = `SELECT c.id, c.hackathonId, c.sponsor, c.sponsorId,
       s.url AS sponsorUrl, s.tier AS sponsorTier,
       c.title, c.description, c.prize, c.active, c.createdAt
       FROM challenges c
       LEFT JOIN sponsors s ON s.id = c.sponsorId`;

// listagem pública: só ativos — desativado fica no banco (histórico/contrato)
export function getChallenges(hackathonId: string): Challenge[] {
  const rows = db
    .prepare(
      `${SELECT} WHERE c.hackathonId = ? AND c.active = 1
       ORDER BY c.createdAt, c.rowid`,
    )
    .all(hackathonId) as Row[];
  return rows.map(toChallenge);
}

// inclui inativos — uso admin
export function listChallenges(hackathonId: string): Challenge[] {
  const rows = db
    .prepare(
      `${SELECT} WHERE c.hackathonId = ?
       ORDER BY c.createdAt, c.rowid`,
    )
    .all(hackathonId) as Row[];
  return rows.map(toChallenge);
}

export function getChallenge(id: string): Challenge | null {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as
    | Row
    | undefined;
  return row ? toChallenge(row) : null;
}

export function createChallenge(
  hackathonId: string,
  input: {
    sponsor?: string;
    sponsorId?: string | null;
    title: string;
    description?: string | null;
    prize?: string | null;
  },
): Challenge {
  const title = input.title?.trim() ?? "";
  if (!title) throw new Error("title obrigatório");

  let sponsorId: string | null = null;
  let sponsorName = input.sponsor?.trim() ?? "";
  if (input.sponsorId !== undefined && input.sponsorId !== null) {
    const entity = getSponsor(String(input.sponsorId).trim());
    if (!entity) throw new Error("sponsor não encontrado");
    sponsorId = entity.id;
    // sem nome textual, o display assume o nome da entidade
    if (!sponsorName) sponsorName = entity.name;
  }
  if (!sponsorName) {
    throw new Error("sponsor obrigatório — é a marca que paga");
  }

  const id = `chal-${randomUUID()}`;
  db.prepare(
    `INSERT INTO challenges (id, hackathonId, sponsor, sponsorId, title, description, prize)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    hackathonId,
    sponsorName,
    sponsorId,
    title,
    input.description?.trim() || null,
    input.prize?.trim() || null,
  );
  return getChallenge(id)!;
}

export type ChallengePatch = {
  sponsor?: string;
  sponsorId?: string | null;
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
  if (patch.sponsorId !== undefined) {
    if (patch.sponsorId === null) {
      sets.push("sponsorId = NULL");
    } else {
      const entity = getSponsor(String(patch.sponsorId).trim());
      if (!entity) throw new Error("sponsor não encontrado");
      sets.push("sponsorId = @sponsorId");
      values.sponsorId = entity.id;
      // vinculou sem mexer no texto? o display acompanha a entidade
      if (patch.sponsor === undefined) {
        sets.push("sponsor = @sponsorFromEntity");
        values.sponsorFromEntity = entity.name;
      }
    }
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
