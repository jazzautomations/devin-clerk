import db from "@/lib/db";
import { completeRegistration, type RegistrationStatus } from "@/lib/registrations";
import { queueTicketEmail } from "@/lib/ticketEmail";

// Walk-in (035 #6): no dia, quem está na fila de espera (ou com pedido
// pendente) aparece na porta. O staff aprova e faz o check-in na hora.
//
// Capacidade: a promoção automática da fila (lib/registrations) já ocupa
// toda vaga livre, então "aprovados < capacidade" nunca é verdade enquanto
// existe fila — exigir isso tornaria o walk-in inútil. No dia, o limite que
// importa é a sala: walk-in só entra se PRESENTES (check-ins) < capacidade.
// É a vaga de quem não veio. Roda com a linha da edição travada (mesmo
// SELECT … FOR UPDATE de lib/registrations), então dois staffs não passam a
// última cadeira pra duas pessoas. A recompensa é a mesma porta de sempre
// (completeRegistration) e o e-mail do ingresso entra na fila como em
// qualquer aprovação.

export type WalkInResult =
  | { ok: true; registrationId: number; memberId: number; username: string; name: string | null; at: string }
  | { ok: false; reason: "not_found" | "rejected" | "already_approved" | "full"; capacity?: number; present?: number };

export async function walkIn(
  hackathonId: string,
  registrationId: number,
  byMemberId: number | null,
): Promise<WalkInResult> {
  if (!Number.isSafeInteger(registrationId) || registrationId <= 0) return { ok: false, reason: "not_found" };
  return db.transaction(async (): Promise<WalkInResult> => {
    const ed = await db
      .prepare("SELECT capacity FROM hackathons WHERE id = ? FOR UPDATE")
      .get<{ capacity: number | null }>(hackathonId);
    if (!ed) return { ok: false, reason: "not_found" };
    const reg = await db
      .prepare(
        `SELECT r.id, r.memberId, r.status, m.username, m.name
         FROM registrations r JOIN members m ON m.id = r.memberId
         WHERE r.id = ? AND r.hackathonId = ? FOR UPDATE OF r`,
      )
      .get<{ id: number; memberId: number; status: RegistrationStatus; username: string; name: string | null }>(
        registrationId,
        hackathonId,
      );
    if (!reg) return { ok: false, reason: "not_found" };
    if (reg.status === "rejected") return { ok: false, reason: "rejected" };
    // aprovado não é walk-in: é check-in normal (QR ou busca manual)
    if (reg.status === "approved") return { ok: false, reason: "already_approved" };

    if (ed.capacity !== null) {
      const row = await db
        .prepare(
          `SELECT COUNT(*)::int AS n FROM checkins c
           JOIN registrations r ON r.id = c.registrationId
           WHERE r.hackathonId = ? AND r.status = 'approved'`,
        )
        .get<{ n: number }>(hackathonId);
      const present = Number(row?.n ?? 0);
      if (present >= ed.capacity) return { ok: false, reason: "full", capacity: ed.capacity, present };
    }

    await db
      .prepare(
        `UPDATE registrations SET status = 'approved', reviewedAt = datetime('now')
         WHERE id = ?`,
      )
      .run(reg.id);
    await completeRegistration(reg.memberId, hackathonId);
    await queueTicketEmail(reg.memberId, hackathonId);
    const ck = await db
      .prepare(
        `INSERT INTO checkins (registrationId, byMemberId, via, syncedAt)
         VALUES (?, ?, 'walkin', datetime('now'))
         ON CONFLICT ("registrationId") DO UPDATE SET via = checkins.via
         RETURNING at`,
      )
      .get<{ at: string }>(reg.id, byMemberId);
    return {
      ok: true,
      registrationId: reg.id,
      memberId: reg.memberId,
      username: reg.username,
      name: reg.name,
      at: ck!.at,
    };
  })();
}

export type WaitlistHit = {
  registrationId: number;
  username: string;
  name: string | null;
  status: "waitlist" | "pending";
  since: string;
};

/** fila de espera + pendentes da edição, na ordem da fila (sem e-mail) */
export async function listWalkInCandidates(hackathonId: string, query = "", limit = 30): Promise<WaitlistHit[]> {
  const q = query.trim().slice(0, 80);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `SELECT r.id AS registrationId, m.username, m.name, r.status,
              COALESCE(r.waitlistedAt, r.createdAt) AS since
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = @h AND r.status IN ('waitlist', 'pending')
         AND (@q = '%%' OR m.username LIKE @q ESCAPE '\\' OR m.name LIKE @q ESCAPE '\\')
       ORDER BY CASE r.status WHEN 'waitlist' THEN 0 ELSE 1 END,
                COALESCE(r.waitlistedAt, r.createdAt), r.id
       LIMIT @limit`,
    )
    .all<WaitlistHit>({ h: hackathonId, q: like, limit });
}
