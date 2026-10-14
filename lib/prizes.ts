import db from "@/lib/db";

// Categorias de prêmio (spec 034 §5 "Júri"). Geral = ranking de todos os
// times entregues (ou só finalistas, se a categoria pedir); desafio = só os
// times que marcaram aquele desafio patrocinado. Os vencedores são gravados
// em prize_winners quando o organizador publica o resultado (lib/jury) e
// viram certificado de premiação por categoria (lib/certificates).
// Este módulo não importa lib/jury — o júri chama ele, nunca o contrário.

export class PrizeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type PrizeKind = "geral" | "desafio";

export type PrizeCategory = {
  id: number;
  hackathonId: string;
  kind: PrizeKind;
  name: string;
  challengeId: string | null;
  challengeTitle: string | null;
  sponsor: string | null;
  places: number;
  finalistsOnly: boolean;
  position: number;
};

type Row = Omit<PrizeCategory, "finalistsOnly"> & { finalistsOnly: number };

export async function listCategories(hackathonId: string): Promise<PrizeCategory[]> {
  const rows = await db
    .prepare(
      `SELECT pc.id, pc.hackathonId, pc.kind, pc.name, pc.challengeId, c.title AS challengeTitle,
              c.sponsor, pc.places, pc.finalistsOnly, pc.position
       FROM prize_categories pc LEFT JOIN challenges c ON c.id = pc.challengeId
       WHERE pc.hackathonId = ? ORDER BY pc.position, pc.id`,
    )
    .all<Row>(hackathonId);
  return rows.map((r) => ({ ...r, finalistsOnly: r.finalistsOnly === 1 }));
}

export async function createCategory(
  hackathonId: string,
  input: Record<string, unknown>,
): Promise<PrizeCategory> {
  const kind = input.kind;
  if (kind !== "geral" && kind !== "desafio") throw new PrizeError("tipo precisa ser geral ou desafio");
  const places = input.places === undefined ? (kind === "geral" ? 3 : 1) : Number(input.places);
  if (!Number.isInteger(places) || places < 1 || places > 10) throw new PrizeError("posições premiadas: 1 a 10");
  let name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length > 80) throw new PrizeError("nome longo demais (máx. 80)");
  let challengeId: string | null = null;
  if (kind === "desafio") {
    const c = await db
      .prepare("SELECT id, title, sponsor FROM challenges WHERE id = ? AND hackathonId = ?")
      .get<{ id: string; title: string; sponsor: string }>(String(input.challengeId ?? ""), hackathonId);
    if (!c) throw new PrizeError("desafio não encontrado nesta edição", 404);
    challengeId = c.id;
    if (!name) name = `Melhor projeto — ${c.sponsor}: ${c.title}`.slice(0, 80);
  }
  if (!name) throw new PrizeError("nome da categoria obrigatório");
  const row = await db
    .prepare(
      `INSERT INTO prize_categories (hackathonId, kind, name, challengeId, places, finalistsOnly, position)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM prize_categories WHERE hackathonId = ?))
       RETURNING id`,
    )
    .get<{ id: number }>(hackathonId, kind, name, challengeId, places, input.finalistsOnly === true ? 1 : 0, hackathonId);
  return (await listCategories(hackathonId)).find((c) => c.id === row!.id)!;
}

export async function deleteCategory(hackathonId: string, id: number) {
  const res = await db
    .prepare("DELETE FROM prize_categories WHERE id = ? AND hackathonId = ?")
    .run(id, hackathonId);
  if (res.changes === 0) throw new PrizeError("categoria não encontrada", 404);
}

export type Winner = {
  categoryId: number;
  categoryName: string;
  kind: PrizeKind;
  teamId: number;
  teamName: string;
  title: string | null;
  place: number;
};

export async function listWinners(hackathonId: string): Promise<Winner[]> {
  return db
    .prepare(
      `SELECT w.categoryId, pc.name AS categoryName, pc.kind, w.teamId, t.name AS teamName,
              tp.title, w.place
       FROM prize_winners w
       JOIN prize_categories pc ON pc.id = w.categoryId
       JOIN teams t ON t.id = w.teamId
       LEFT JOIN team_projects tp ON tp.teamId = t.id
       WHERE pc.hackathonId = ?
       ORDER BY pc.position, pc.id, w.place, t.name`,
    )
    .all<Winner>(hackathonId);
}

type Ranked = { teamId: number; rank: number | null };

/**
 * Puro: candidatos da categoria a partir do conjunto elegível. Desafio só
 * com quem marcou; finalistsOnly só com finalista.
 */
export function categoryCandidates<T extends { id: number; finalist?: boolean }>(
  category: Pick<PrizeCategory, "kind" | "challengeId" | "finalistsOnly">,
  teams: T[],
  challengesByTeam: Map<number, string[]>,
): T[] {
  return teams.filter((t) => {
    if (category.finalistsOnly && !t.finalist) return false;
    if (category.kind === "desafio") {
      return (challengesByTeam.get(t.id) ?? []).includes(category.challengeId ?? "");
    }
    return true;
  });
}

/** puro: vencedores = posição ≤ places (empate divide e entra junto) */
export function pickWinners(ranking: Ranked[], places: number): { teamId: number; place: number }[] {
  return ranking
    .filter((r) => r.rank !== null && r.rank <= places)
    .map((r) => ({ teamId: r.teamId, place: r.rank! }));
}

/** troca os vencedores da edição de uma vez (chamado dentro da transação da publicação) */
export async function replaceWinners(
  hackathonId: string,
  winners: { categoryId: number; teamId: number; place: number }[],
) {
  await db
    .prepare(
      `DELETE FROM prize_winners WHERE categoryId IN
         (SELECT id FROM prize_categories WHERE hackathonId = ?)`,
    )
    .run(hackathonId);
  for (const w of winners) {
    await db
      .prepare("INSERT INTO prize_winners (categoryId, teamId, place) VALUES (?, ?, ?)")
      .run(w.categoryId, w.teamId, w.place);
  }
}
