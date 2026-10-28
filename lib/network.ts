import db from "@/lib/db";
import { isMinorAtEdition } from "@/lib/teamboard";

// canNetwork: a ÚNICA porta de toda superfície pública ou de contato da rede
// social (perfil aberto, seguir, recado, depoimento, encontro, DM, vitrine).
// Quem for mostrar uma pessoa pra outra chama isto e mais nada — a regra de
// idade mora só aqui (não espalhe isMinorAtEdition pelas features).
//
// - conta excluída/anonimizada (ou inexistente): false;
// - o HackaHub é 18+ (lib/eventTerms.ts). Só com HACKAHUB_ALLOW_MINORS=on
//   existe menor na plataforma; aí quem é menor naquela edição fica fora
//   dela, e sem edição quem ainda não tem 18 hoje (registration_terms.birthDate)
//   fica fora de tudo.

export async function canNetwork(memberId: number, hackathonId?: string): Promise<boolean> {
  const m = await db.prepare("SELECT clerkId FROM members WHERE id = ?").get<{ clerkId: string }>(memberId);
  if (!m || m.clerkId.startsWith("deleted:")) return false;
  if (process.env.HACKAHUB_ALLOW_MINORS !== "on") return true;
  if (hackathonId) return !(await isMinorAtEdition(memberId, hackathonId));
  // sem edição: a idade de HOJE, pela data de nascimento que a pessoa deu em
  // qualquer inscrição. Menor que ainda não fez 18 continua fora mesmo depois
  // que a edição em que se inscreveu acabou.
  const minorNow = await db
    .prepare(
      `SELECT 1 AS y FROM registration_terms
       WHERE memberId = ?
         AND birthDate::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '18 years'
       LIMIT 1`,
    )
    .get<{ y: number }>(memberId);
  return !minorNow;
}
