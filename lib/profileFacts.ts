import db from "@/lib/db";
import { countFacts, eligibleEditionsSql } from "@/lib/evidence";
import { getMemberProjects, type MemberProject } from "@/lib/archive";
import { canNetwork } from "@/lib/network";
import { countAccepted, listAccepted } from "@/lib/testimonials";

// Números e fixados do perfil (spec 046, perfil-rico, migration 041).
//
// Os quatro números do /u saem de countFacts (lib/evidence.ts) numa ida ao
// banco: nada de query própria somando o que a evidência já conta. Zero
// aparece como "—" na tela, nunca como 0 competindo com quem tem fato.

export type ProfileNumbers = {
  /** edições com presença (check-in da inscrição aprovada) */
  presenca: number;
  /** entregas travadas (1 por time) */
  entrega: number;
  /** prêmios (1 por categoria) */
  premio: number;
  /** organizou, mentorou ou julgou (mentoria + organizou, 1 por edição) */
  papel: number;
};

export async function profileNumbers(memberId: number): Promise<ProfileNumbers> {
  const c = await countFacts(memberId);
  return { presenca: c.presenca, entrega: c.entrega, premio: c.premio, papel: c.mentoria + c.organizou };
}

/** os quatro números na ordem da faixa do perfil: rótulo, valor e aba */
export const PROFILE_NUMBER_LABELS: { key: keyof ProfileNumbers; label: string; aba: string }[] = [
  { key: "presenca", label: "edições", aba: "trajetoria" },
  { key: "entrega", label: "entregas", aba: "projetos" },
  { key: "premio", label: "prêmios", aba: "trajetoria" },
  { key: "papel", label: "organizou ou mentorou", aba: "trajetoria" },
];

/** zero vira travessão: o perfil não mostra placar de zero */
export const numberLabel = (n: number) => (n > 0 ? String(n) : "—");

// ---------- projetos fixados ----------

export const MAX_PINS = 3;

/** ids dos times fixados, na ordem em que a pessoa escolheu */
export async function listPins(memberId: number): Promise<number[]> {
  const rows = await db
    .prepare(`SELECT "teamId" AS id FROM member_pins WHERE "memberId" = ? ORDER BY "position", "teamId"`)
    .all<{ id: number }>(memberId);
  return rows.map((r) => Number(r.id));
}

/**
 * Grava os fixados: até MAX_PINS, cada um de um time da própria pessoa
 * (team_members guarda o @). Time de outra pessoa ou id inexistente: erro.
 */
export async function setPins(
  member: { id: number; username: string },
  teamIds: unknown,
): Promise<number[]> {
  if (!Array.isArray(teamIds)) throw new Error("fixados deve ser uma lista");
  const ids: number[] = [];
  for (const raw of teamIds) {
    const id = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("fixado inválido");
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_PINS) throw new Error(`fixe até ${MAX_PINS} projetos`);
  if (ids.length > 0) {
    const rows = await db
      .prepare(
        `SELECT t.id FROM teams t
         JOIN team_members tm ON tm."teamId" = t.id
         WHERE t.id = ANY(?::int[]) AND tm.username = ?`,
      )
      .all<{ id: number }>(ids, member.username);
    const mine = new Set(rows.map((r) => Number(r.id)));
    if (ids.some((id) => !mine.has(id))) throw new Error("esse projeto não é seu");
  }
  await db.transaction(async () => {
    await db.prepare(`DELETE FROM member_pins WHERE "memberId" = ?`).run(member.id);
    for (const [position, id] of ids.entries()) {
      await db
        .prepare(`INSERT INTO member_pins ("memberId", "teamId", "position") VALUES (?, ?, ?)`)
        .run(member.id, id, position);
    }
  })();
  return ids;
}

/**
 * Os até 3 cards de projeto do perfil. Com fixados, a ordem é a escolhida.
 * Sem fixados: premiados primeiro (1º, 2º, 3º) e depois os mais recentes,
 * que é a ordem de getMemberProjects.
 */
export async function pinnedProjects(
  memberId: number,
  username: string,
): Promise<{ projects: MemberProject[]; pinned: boolean }> {
  const all = await getMemberProjects(username);
  const pins = await listPins(memberId);
  if (pins.length > 0) {
    const byTeam = new Map(all.map((p) => [p.teamId, p]));
    const picked = pins.map((id) => byTeam.get(id)).filter((p): p is MemberProject => !!p);
    if (picked.length > 0) return { projects: picked, pinned: true };
  }
  const prize = all
    .filter((p) => p.placement >= 1 && p.placement <= 3)
    .sort((a, b) => a.placement - b.placement);
  const rest = all.filter((p) => !(p.placement >= 1 && p.placement <= 3));
  return { projects: [...prize, ...rest].slice(0, MAX_PINS), pinned: false };
}

// ---------- depoimentos (contagem em lote pro /talento) ----------

export type TestimonialStats = { count: number; first: string | null };

/**
 * Quantos depoimentos aceitos contam e o primeiro trecho, pra uma lista de
 * pessoas. Mesma regra de countAccepted (lib/testimonials.ts): aceito, autor
 * ativo, sem bloqueio com quem lê e edição elegível (eligibleEditionsSql).
 *
 * Com HACKAHUB_ALLOW_MINORS=on a regra de idade de canNetwork pesa por
 * pessoa, então cai no caminho de countAccepted (uma por pessoa) em vez de
 * arriscar número diferente do perfil.
 */
export async function testimonialStats(memberIds: number[]): Promise<Map<number, TestimonialStats>> {
  const out = new Map<number, TestimonialStats>();
  const ids = [...new Set(memberIds.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (ids.length === 0) return out;
  if (process.env.HACKAHUB_ALLOW_MINORS === "on") {
    await Promise.all(
      ids.map(async (id) => {
        const [count, list] = await Promise.all([countAccepted(id), listAccepted(id)]);
        out.set(id, { count, first: list[0]?.body ?? null });
      }),
    );
    return out;
  }
  const rows = await db
    .prepare(
      `SELECT t."memberId" AS id, COUNT(*)::int AS n,
              (ARRAY_AGG(t.body ORDER BY to_ts(t."acceptedAt") DESC NULLS LAST, t.id DESC))[1] AS first
       FROM team_testimonials t
       JOIN members a ON a.id = t."authorId"
       WHERE t.status = 'aceito'
         AND t."memberId" = ANY(?::int[])
         AND a."clerkId" NOT LIKE 'deleted:%'
         AND t."hackathonId" IN (${eligibleEditionsSql})
       GROUP BY t."memberId"`,
    )
    .all<{ id: number; n: number; first: string | null }>(ids);
  for (const r of rows) out.set(Number(r.id), { count: Number(r.n), first: r.first });
  for (const id of ids) if (!out.has(id)) out.set(id, { count: 0, first: null });
  return out;
}

/** quem aparece no perfil aberto: conta ativa (canNetwork) e opt-in */
export async function openProfile(memberId: number, publicProfile: number | boolean): Promise<boolean> {
  if (!publicProfile) return false;
  return canNetwork(memberId);
}
