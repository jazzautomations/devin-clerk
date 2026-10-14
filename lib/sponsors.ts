import { randomUUID } from "node:crypto";
import db from "@/lib/db";

// challenges.sponsorId liga o desafio ao sponsor; challenges.sponsor (TEXT)
// segue como nome de exibição/fallback.
export const SPONSOR_TIERS = ["apoio", "sponsor", "master"] as const;
export type SponsorTier = (typeof SPONSOR_TIERS)[number];

export type Sponsor = {
  id: string;
  name: string;
  url: string | null;
  tier: SponsorTier;
  contactEmail: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
};

// listagem admin traz quantos desafios já apontam pra marca
export type SponsorRow = Sponsor & { challengeCount: number };

type Row = Omit<Sponsor, "active"> & { active: number };

function toSponsor(row: Row): Sponsor {
  return { ...row, active: row.active === 1 };
}

export async function getSponsor(id: string): Promise<Sponsor | null> {
  const row = await db.prepare("SELECT * FROM sponsors WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toSponsor(row) : null;
}

// inclui inativos — uso admin; ordena ativos primeiro
export async function listSponsors(): Promise<SponsorRow[]> {
  const rows = await db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM challenges c WHERE c.sponsorId = s.id)
          AS challengeCount
       FROM sponsors s
       ORDER BY s.active DESC, lower(s.name)`,
    )
    .all() as (Row & { challengeCount: number })[];
  return rows.map((r) => ({ ...toSponsor(r), challengeCount: r.challengeCount }));
}

export async function getSponsorForChallenge(challengeId: string): Promise<Sponsor | null> {
  const row = await db
    .prepare(
      `SELECT s.* FROM sponsors s
       JOIN challenges c ON c.sponsorId = s.id
       WHERE c.id = ?`,
    )
    .get(challengeId) as Row | undefined;
  return row ? toSponsor(row) : null;
}

const opt = (v?: string | null) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export async function createSponsor(input: {
  name: string;
  url?: string | null;
  tier?: SponsorTier;
  contactEmail?: string | null;
  notes?: string | null;
}): Promise<Sponsor> {
  const name = input.name?.trim() ?? "";
  if (!name) throw new Error("name obrigatório");
  const tier = input.tier ?? "sponsor";
  if (!SPONSOR_TIERS.includes(tier)) throw new Error("tier inválido");
  if (await db.prepare("SELECT 1 FROM sponsors WHERE name = ?").get(name)) {
    throw new Error("já existe um sponsor com esse nome");
  }
  const id = `spon-${randomUUID()}`;
  await db.prepare(
    `INSERT INTO sponsors (id, name, url, tier, contactEmail, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    opt(input.url),
    tier,
    opt(input.contactEmail),
    opt(input.notes),
  );
  return (await getSponsor(id))!;
}

export type SponsorPatch = {
  name?: string;
  url?: string | null;
  tier?: SponsorTier;
  contactEmail?: string | null;
  notes?: string | null;
  active?: boolean;
};

// update parcial: só os campos presentes são tocados; null limpa o campo.
// desativar nunca apaga — contrato encerrado ≠ histórico apagado
export async function updateSponsor(
  id: string,
  patch: SponsorPatch,
): Promise<Sponsor | null> {
  if (!await getSponsor(id)) return null;

  const sets: string[] = [];
  const values: Record<string, unknown> = { id };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("name obrigatório");
    if (
      await db
        .prepare("SELECT 1 FROM sponsors WHERE name = ? AND id != ?")
        .get(name, id)
    ) {
      throw new Error("já existe um sponsor com esse nome");
    }
    sets.push("name = @name");
    values.name = name;
  }
  if (patch.url !== undefined) {
    sets.push("url = @url");
    values.url = opt(patch.url);
  }
  if (patch.tier !== undefined) {
    if (!SPONSOR_TIERS.includes(patch.tier)) throw new Error("tier inválido");
    sets.push("tier = @tier");
    values.tier = patch.tier;
  }
  if (patch.contactEmail !== undefined) {
    sets.push("contactEmail = @contactEmail");
    values.contactEmail = opt(patch.contactEmail);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = @notes");
    values.notes = opt(patch.notes);
  }
  if (patch.active !== undefined) {
    sets.push("active = @active");
    values.active = patch.active ? 1 : 0;
  }

  if (sets.length > 0) {
    await db.prepare(`UPDATE sponsors SET ${sets.join(", ")} WHERE id = @id`).run(
      values,
    );
  }
  return getSponsor(id);
}
