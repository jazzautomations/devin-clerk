import db from "@/lib/db";
import { getRsvpFunnel } from "@/lib/rsvp";

// Visão geral do painel da edição (frente N #1/#2): o funil inteiro numa
// tela — curadoria, RSVP e fila de espera. Só números agregados.

export type EditionOverview = {
  total: number;
  pending: number;
  /** aprovados hoje (ocupando vaga) */
  approved: number;
  rsvpEnabled: boolean;
  confirmed: number;
  /** recusaram no RSVP (vaga liberada) */
  declined: number;
  /** convidados que ainda não responderam */
  noResponse: number;
  /** não responderam até o prazo — vaga voltou pra fila */
  expired: number;
  /** aprovados que ainda não receberam o convite do RSVP */
  notInvited: number;
  waitlist: number;
  /** quantos já saíram da fila pra uma vaga */
  promoted: number;
};

export async function getEditionOverview(hackathonId: string): Promise<EditionOverview> {
  const [counts, funnel] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE r.status = 'pending') AS pending,
           COUNT(*) FILTER (WHERE r.status = 'approved') AS approved,
           COUNT(*) FILTER (WHERE r.status = 'waitlist') AS waitlist,
           COUNT(*) FILTER (WHERE r.promotedAt IS NOT NULL) AS promoted,
           (SELECT h.rsvpEnabled FROM hackathons h WHERE h.id = ?) AS "rsvpEnabled"
         FROM registrations r WHERE r.hackathonId = ?`,
      )
      .get<{
        total: number;
        pending: number;
        approved: number;
        waitlist: number;
        promoted: number;
        rsvpEnabled: number | null;
      }>(hackathonId, hackathonId),
    getRsvpFunnel(hackathonId),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    total: n(counts?.total),
    pending: n(counts?.pending),
    approved: n(counts?.approved),
    rsvpEnabled: counts?.rsvpEnabled === 1,
    confirmed: funnel.confirmed,
    declined: funnel.declined,
    noResponse: funnel.pending,
    expired: funnel.expired,
    notInvited: funnel.notInvited,
    waitlist: n(counts?.waitlist),
    promoted: n(counts?.promoted),
  };
}
