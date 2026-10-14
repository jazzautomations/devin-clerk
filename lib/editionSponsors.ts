import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { createSponsor, SPONSOR_TIERS, type SponsorTier } from "@/lib/sponsors";

// Patrocinadores da edição (roadmap 037 #8, migration 017). A marca é a
// entidade global `sponsors` (nome único, desafios apontam pra ela); o que
// é da edição — nível, logo, site — mora em edition_sponsors. O papel
// "patrocinador" é por (edição, marca): quem é da marca A nunca enxerga a B.

export class SponsorError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type EditionSponsor = {
  hackathonId: string;
  sponsorId: string;
  name: string;
  tier: SponsorTier;
  logoUrl: string | null;
  url: string | null;
  position: number;
};

export const TIER_LABEL: Record<SponsorTier, string> = {
  master: "master",
  sponsor: "patrocínio",
  apoio: "apoio",
};

const TIER_ORDER = "CASE es.tier WHEN 'master' THEN 0 WHEN 'sponsor' THEN 1 ELSE 2 END";

const SELECT = `SELECT es.hackathonId, es.sponsorId, s.name, es.tier, es.logoUrl,
       COALESCE(es.url, s.url) AS url, es.position
  FROM edition_sponsors es JOIN sponsors s ON s.id = es.sponsorId`;

export async function listEditionSponsors(hackathonId: string): Promise<EditionSponsor[]> {
  return db
    .prepare(`${SELECT} WHERE es.hackathonId = ? ORDER BY ${TIER_ORDER}, es.position, lower(s.name)`)
    .all<EditionSponsor>(hackathonId);
}

export async function getEditionSponsor(hackathonId: string, sponsorId: string): Promise<EditionSponsor | null> {
  return (
    (await db
      .prepare(`${SELECT} WHERE es.hackathonId = ? AND es.sponsorId = ?`)
      .get<EditionSponsor>(hackathonId, sponsorId)) ?? null
  );
}

const httpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u);

function optUrl(v: unknown, key: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw new SponsorError(`${key} inválido`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > 500 || !httpUrl(s)) throw new SponsorError(`${key}: URL inválida — só http(s)`);
  return s;
}

function tierOf(v: unknown, fallback: SponsorTier = "sponsor"): SponsorTier {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !(SPONSOR_TIERS as readonly string[]).includes(v)) {
    throw new SponsorError("nível precisa ser master, sponsor ou apoio");
  }
  return v as SponsorTier;
}

/**
 * Cadastra o patrocinador na edição pelo nome. Marca existente (nome igual,
 * sem diferenciar caixa) é reaproveitada — o mesmo patrocinador em duas
 * edições é a mesma marca; senão nasce uma nova.
 */
export async function addEditionSponsor(
  hackathonId: string,
  input: Record<string, unknown>,
  actorId: number | null,
): Promise<EditionSponsor> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new SponsorError("nome do patrocinador obrigatório");
  if (name.length > 80) throw new SponsorError("nome longo demais (máx. 80)");
  const tier = tierOf(input.tier);
  const logoUrl = optUrl(input.logoUrl, "logoUrl");
  const url = optUrl(input.url, "url");

  const existing = await db
    .prepare("SELECT id FROM sponsors WHERE lower(name) = lower(?)")
    .get<{ id: string }>(name);
  const sponsorId = existing?.id ?? (await createSponsor({ name, url, tier })).id;
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO edition_sponsors (hackathonId, sponsorId, tier, logoUrl, url, createdBy, position)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM edition_sponsors WHERE hackathonId = ?))`,
    )
    .run(hackathonId, sponsorId, tier, logoUrl, url, actorId, hackathonId);
  if (res.changes === 0) throw new SponsorError("esse patrocinador já está na edição", 409);
  return (await getEditionSponsor(hackathonId, sponsorId))!;
}

async function requireInEdition(hackathonId: string, sponsorId: string): Promise<EditionSponsor> {
  const s = await getEditionSponsor(hackathonId, sponsorId);
  if (!s) throw new SponsorError("patrocinador não encontrado nesta edição", 404);
  return s;
}

function idList(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" && typeof x !== "number")) {
    throw new SponsorError(`${key} precisa ser lista`);
  }
  return [...new Set(v.map(String))];
}

/**
 * Atualiza nível/logo/site e (opcional) os vínculos: challengeIds = desafios
 * da edição que são desta marca (o resto que apontava pra ela é desligado);
 * categoryIds = categorias GERAIS oferecidas por ela. Categoria de desafio
 * segue o desafio.
 */
export async function updateEditionSponsor(
  hackathonId: string,
  sponsorId: string,
  raw: Record<string, unknown>,
): Promise<EditionSponsor> {
  const current = await requireInEdition(hackathonId, sponsorId);
  const sets: string[] = [];
  const values: Record<string, unknown> = { h: hackathonId, s: sponsorId };
  if (raw.tier !== undefined) {
    sets.push("tier = @tier");
    values.tier = tierOf(raw.tier);
  }
  for (const k of ["logoUrl", "url"] as const) {
    if (raw[k] === undefined) continue;
    sets.push(`${k} = @${k}`);
    values[k] = optUrl(raw[k], k);
  }
  const challengeIds = raw.challengeIds === undefined ? null : idList(raw.challengeIds, "challengeIds");
  const categoryIds = raw.categoryIds === undefined ? null : idList(raw.categoryIds, "categoryIds").map(Number);
  if (sets.length === 0 && !challengeIds && !categoryIds) throw new SponsorError("nada pra atualizar");

  if (challengeIds) {
    const valid = new Set(
      (await db.prepare("SELECT id FROM challenges WHERE hackathonId = ?").all<{ id: string }>(hackathonId)).map(
        (r) => r.id,
      ),
    );
    if (challengeIds.some((c) => !valid.has(c))) throw new SponsorError("desafio não é desta edição");
  }
  if (categoryIds) {
    if (categoryIds.some((c) => !Number.isInteger(c))) throw new SponsorError("categoria inválida");
    const valid = new Set(
      (
        await db
          .prepare("SELECT id FROM prize_categories WHERE hackathonId = ? AND kind = 'geral'")
          .all<{ id: number }>(hackathonId)
      ).map((r) => r.id),
    );
    if (categoryIds.some((c) => !valid.has(c))) throw new SponsorError("categoria geral não é desta edição");
  }

  await db.transaction(async () => {
    if (sets.length > 0) {
      await db
        .prepare(`UPDATE edition_sponsors SET ${sets.join(", ")} WHERE hackathonId = @h AND sponsorId = @s`)
        .run(values);
    }
    if (challengeIds) {
      await db
        .prepare("UPDATE challenges SET sponsorId = NULL WHERE hackathonId = ? AND sponsorId = ?")
        .run(hackathonId, sponsorId);
      for (const c of challengeIds) {
        await db
          .prepare("UPDATE challenges SET sponsorId = ?, sponsor = ? WHERE id = ? AND hackathonId = ?")
          .run(sponsorId, current.name, c, hackathonId);
      }
    }
    if (categoryIds) {
      await db
        .prepare("UPDATE prize_categories SET sponsorId = NULL WHERE hackathonId = ? AND sponsorId = ?")
        .run(hackathonId, sponsorId);
      for (const c of categoryIds) {
        await db
          .prepare("UPDATE prize_categories SET sponsorId = ? WHERE id = ? AND hackathonId = ?")
          .run(sponsorId, c, hackathonId);
      }
    }
  })();
  return (await getEditionSponsor(hackathonId, sponsorId))!;
}

/** tira da edição (pessoas, convites e opt-ins vão junto); a marca global fica */
export async function removeEditionSponsor(hackathonId: string, sponsorId: string): Promise<void> {
  await requireInEdition(hackathonId, sponsorId);
  await db.transaction(async () => {
    await db
      .prepare("UPDATE challenges SET sponsorId = NULL WHERE hackathonId = ? AND sponsorId = ?")
      .run(hackathonId, sponsorId);
    await db
      .prepare("UPDATE prize_categories SET sponsorId = NULL WHERE hackathonId = ? AND sponsorId = ?")
      .run(hackathonId, sponsorId);
    await db.prepare("DELETE FROM edition_sponsors WHERE hackathonId = ? AND sponsorId = ?").run(hackathonId, sponsorId);
  })();
}

/** desafios da edição ligados à marca */
export async function sponsorChallenges(hackathonId: string, sponsorId: string) {
  return db
    .prepare(
      `SELECT id, title, prize FROM challenges
       WHERE hackathonId = ? AND sponsorId = ? ORDER BY createdAt, seq`,
    )
    .all<{ id: string; title: string; prize: string | null }>(hackathonId, sponsorId);
}

/** categorias de prêmio da marca: as dos desafios dela + as gerais que ela oferece */
export async function sponsorCategories(hackathonId: string, sponsorId: string) {
  return db
    .prepare(
      `SELECT pc.id, pc.name, pc.kind, pc.places FROM prize_categories pc
       LEFT JOIN challenges c ON c.id = pc.challengeId
       WHERE pc.hackathonId = ? AND (c.sponsorId = ? OR pc.sponsorId = ?)
       ORDER BY pc.position, pc.id`,
    )
    .all<{ id: number; name: string; kind: "geral" | "desafio"; places: number }>(hackathonId, sponsorId, sponsorId);
}

/** categorias gerais da edição com a marca que oferece (painel) */
export async function listGeneralCategories(hackathonId: string) {
  return db
    .prepare(
      `SELECT id, name, sponsorId FROM prize_categories
       WHERE hackathonId = ? AND kind = 'geral' ORDER BY position, id`,
    )
    .all<{ id: number; name: string; sponsorId: string | null }>(hackathonId);
}

/** logo da marca por desafio (ficha do projeto) — só marca cadastrada na edição */
export async function sponsorLogosForChallenges(
  challengeIds: string[],
): Promise<Map<string, { name: string; logoUrl: string | null; url: string | null }>> {
  const map = new Map<string, { name: string; logoUrl: string | null; url: string | null }>();
  if (challengeIds.length === 0) return map;
  const rows = await db
    .prepare(
      `SELECT c.id AS "challengeId", s.name, es.logoUrl, COALESCE(es.url, s.url) AS url
       FROM challenges c
       JOIN edition_sponsors es ON es.sponsorId = c.sponsorId AND es.hackathonId = c.hackathonId
       JOIN sponsors s ON s.id = es.sponsorId
       WHERE c.id = ANY(?)`,
    )
    .all<{ challengeId: string; name: string; logoUrl: string | null; url: string | null }>(challengeIds);
  for (const r of rows) map.set(r.challengeId, { name: r.name, logoUrl: r.logoUrl, url: r.url });
  return map;
}

// ---------- pessoas do patrocinador ----------

export type SponsorPerson = { memberId: number; username: string; name: string | null };

export async function isSponsorMember(hackathonId: string, sponsorId: string, memberId: number): Promise<boolean> {
  return !!(await db
    .prepare("SELECT 1 FROM edition_sponsor_members WHERE hackathonId = ? AND sponsorId = ? AND memberId = ?")
    .get(hackathonId, sponsorId, memberId));
}

/** marcas da edição de que o membro faz parte (abas do painel) */
export async function mySponsorships(
  hackathonId: string,
  memberId: number,
): Promise<{ sponsorId: string; name: string }[]> {
  return db
    .prepare(
      `SELECT esm.sponsorId, s.name FROM edition_sponsor_members esm
       JOIN sponsors s ON s.id = esm.sponsorId
       WHERE esm.hackathonId = ? AND esm.memberId = ? ORDER BY lower(s.name)`,
    )
    .all<{ sponsorId: string; name: string }>(hackathonId, memberId);
}

export async function listSponsorPeople(hackathonId: string, sponsorId: string) {
  const [people, invites] = await Promise.all([
    db
      .prepare(
        `SELECT m.id AS "memberId", m.username, m.name FROM edition_sponsor_members esm
         JOIN members m ON m.id = esm.memberId
         WHERE esm.hackathonId = ? AND esm.sponsorId = ? ORDER BY m.username`,
      )
      .all<SponsorPerson>(hackathonId, sponsorId),
    db
      .prepare(
        `SELECT email, createdAt FROM edition_sponsor_invites
         WHERE hackathonId = ? AND sponsorId = ? ORDER BY createdAt, email`,
      )
      .all<{ email: string; createdAt: string }>(hackathonId, sponsorId),
  ]);
  return { people, invites };
}

const reportHref = (hackathonId: string, sponsorId: string) => `/admin/h/${hackathonId}/patrocinador/${sponsorId}`;

async function grantSponsorMember(hackathonId: string, sponsorId: string, memberId: number, by: number | null) {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO edition_sponsor_members (hackathonId, sponsorId, memberId, grantedBy)
       VALUES (?, ?, ?, ?)`,
    )
    .run(hackathonId, sponsorId, memberId, by);
  if (res.changes > 0) {
    const s = await getEditionSponsor(hackathonId, sponsorId);
    await notify(memberId, {
      type: "sponsor_access",
      text: `Você tem acesso ao relatório de ${s?.name ?? "patrocinador"} na edição`,
      href: reportHref(hackathonId, sponsorId),
    });
  }
}

/** convida por e-mail: membro existente ganha acesso na hora; senão vale no primeiro login */
export async function inviteSponsorPerson(
  hackathonId: string,
  sponsorId: string,
  email: unknown,
  invitedBy: number | null,
): Promise<"granted" | "pending"> {
  await requireInEdition(hackathonId, sponsorId);
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new SponsorError("e-mail inválido");
  }
  const member = await db
    .prepare("SELECT id FROM members WHERE lower(email) = ?")
    .get<{ id: number }>(normalized);
  if (member) {
    await grantSponsorMember(hackathonId, sponsorId, member.id, invitedBy);
    return "granted";
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO edition_sponsor_invites (hackathonId, sponsorId, email, invitedBy)
       VALUES (?, ?, ?, ?)`,
    )
    .run(hackathonId, sponsorId, normalized, invitedBy);
  return "pending";
}

export async function removeSponsorPerson(hackathonId: string, sponsorId: string, memberId: number) {
  await db
    .prepare("DELETE FROM edition_sponsor_members WHERE hackathonId = ? AND sponsorId = ? AND memberId = ?")
    .run(hackathonId, sponsorId, memberId);
}

export async function cancelSponsorInvite(hackathonId: string, sponsorId: string, email: string) {
  await db
    .prepare("DELETE FROM edition_sponsor_invites WHERE hackathonId = ? AND sponsorId = ? AND email = ?")
    .run(hackathonId, sponsorId, email.trim().toLowerCase());
}

/** primeiro login: convites pendentes do e-mail viram acesso (getOrCreateMember) */
export async function claimSponsorInvites(memberId: number, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await db.transaction(async () => {
    const invites = await db
      .prepare("SELECT hackathonId, sponsorId, invitedBy FROM edition_sponsor_invites WHERE email = ?")
      .all<{ hackathonId: string; sponsorId: string; invitedBy: number | null }>(normalized);
    for (const inv of invites) await grantSponsorMember(inv.hackathonId, inv.sponsorId, memberId, inv.invitedBy);
    await db.prepare("DELETE FROM edition_sponsor_invites WHERE email = ?").run(normalized);
  })();
}
