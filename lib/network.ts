import db from "@/lib/db";
import { isMinorAtEdition } from "@/lib/teamboard";

// canNetwork: a ÚNICA porta de toda superfície pública ou de contato da rede
// social (perfil aberto, seguir, recado, depoimento, encontro, DM, vitrine).
// Quem for mostrar uma pessoa pra outra chama isto e mais nada — a regra de
// idade mora só aqui (não espalhe isMinorAtEdition pelas features).
//
// - conta excluída/anonimizada (ou inexistente): false;
// - o HackaHub é 18+ (lib/eventTerms.ts). Só com HACKAHUB_ALLOW_MINORS=on
//   existe menor na plataforma; aí quem é menor naquela edição (ou, sem
//   edição, em qualquer edição ativa que ainda não acabou) fica fora.

export async function canNetwork(memberId: number, hackathonId?: string): Promise<boolean> {
  const m = await db.prepare("SELECT clerkId FROM members WHERE id = ?").get<{ clerkId: string }>(memberId);
  if (!m || m.clerkId.startsWith("deleted:")) return false;
  if (process.env.HACKAHUB_ALLOW_MINORS !== "on") return true;
  if (hackathonId) return !(await isMinorAtEdition(memberId, hackathonId));
  const editions = await db
    .prepare(
      `SELECT DISTINCT rt.hackathonId AS "hackathonId"
       FROM registration_terms rt JOIN hackathons h ON h.id = rt.hackathonId
       WHERE rt.memberId = ? AND h.active = 1
         AND COALESCE(to_ts(COALESCE(h.endsAt, h.registrationDeadline, h.startsAt)) >= now(), true)`,
    )
    .all<{ hackathonId: string }>(memberId);
  const minor = await Promise.all(editions.map((e) => isMinorAtEdition(memberId, e.hackathonId)));
  return !minor.some(Boolean);
}
