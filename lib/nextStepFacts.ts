import db from "@/lib/db";
import { editionPhase } from "@/lib/arena";
import { flowEnabled, formatBrt, getSubmissionSettings, lockAt, myEntry, parseDbTime, toDbTime } from "@/lib/entries";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
import type { Member } from "@/lib/members";
import { getMyNps, getNpsWindow, npsPhase, npsRoleFor } from "@/lib/nps";
import { getEditionCapacity, getRegistrationStatus, getWaitlistPosition } from "@/lib/registrations";
import { getMyApplications, type ApplicationKind, type ApplicationStatus } from "@/lib/roleApplications";
import { fromSqlTime, formatDeadline, rsvpToken } from "@/lib/rsvp";
import { getSession } from "@/lib/stage";
import { nextStep, type NextStep, type NextStepFacts } from "@/lib/nextStep";

// spec 039 — junta do banco os fatos que lib/nextStep precisa pra decidir o
// próximo passo da pessoa numa edição. Só lê; nunca muda estado.

type RsvpRow = { id: number; rsvpStatus: string | null; rsvpDeadlineAt: string | null };

export async function getNextStepFacts(
  h: Hackathon,
  member: Pick<Member, "id" | "username"> | null,
  now = new Date(),
): Promise<NextStepFacts> {
  const phase = editionPhase(h, now);
  const over = phase === "ended" || phase === "archived";
  const registrationClosed = h.registrationDeadline !== null && new Date(h.registrationDeadline) < now;

  const [cap, status, apps, settings, stage] = await Promise.all([
    getEditionCapacity(h.id),
    member ? getRegistrationStatus(member.id, h.id) : Promise.resolve(null),
    member
      ? getMyApplications(member.id, h.id)
      : Promise.resolve({} as Partial<Record<ApplicationKind, ApplicationStatus>>),
    h.partner ? getSubmissionSettings(h.id) : Promise.resolve(null),
    h.partner && !over ? getSession(h.id) : Promise.resolve(null),
  ]);
  const approved = status === "approved";
  const helpingEntry = (Object.entries(apps) as [ApplicationKind, ApplicationStatus][]).find(([, st]) => st !== "rejected");

  const [position, rsvpRow, ticket, entry, certificate, npsPending] = await Promise.all([
    member && status === "waitlist" ? getWaitlistPosition(member.id, h.id) : Promise.resolve(null),
    member && approved
      ? db
          .prepare(`SELECT id, rsvpStatus, rsvpDeadlineAt FROM registrations WHERE memberId = ? AND hackathonId = ?`)
          .get<RsvpRow>(member.id, h.id)
      : Promise.resolve(undefined),
    // só a presença (sem gerar o token do QR: isso é do /ingresso)
    member && approved && !over
      ? db
          .prepare(
            `SELECT c.at AS "checkedInAt" FROM registrations r JOIN checkins c ON c.registrationId = r.id
             WHERE r.memberId = ? AND r.hackathonId = ?`,
          )
          .get<{ checkedInAt: string }>(member.id, h.id)
      : Promise.resolve(undefined),
    member && approved && flowEnabled(settings) ? myEntry(h.id, member.username, now) : Promise.resolve(null),
    member
      ? db
          .prepare(`SELECT code FROM certificates WHERE memberId = ? AND hackathonId = ? ORDER BY issuedAt DESC LIMIT 1`)
          .get<{ code: string }>(member.id, h.id)
      : Promise.resolve(undefined),
    member && approved && over ? npsIsPending(h.id, member.id, now) : Promise.resolve(false),
  ]);

  let rsvp: NextStepFacts["rsvp"] = null;
  if (rsvpRow?.rsvpStatus === "pending" && rsvpRow.rsvpDeadlineAt) {
    const deadline = fromSqlTime(rsvpRow.rsvpDeadlineAt);
    if (deadline.getTime() > now.getTime()) {
      rsvp = { href: `/rsvp/${rsvpToken(rsvpRow.id, deadline)}`, deadline: formatDeadline(deadline) };
    }
  }

  let submission: NextStepFacts["submission"] = null;
  if (flowEnabled(settings)) {
    const opens = parseDbTime(settings.submissionOpensAt);
    const lock = lockAt(settings);
    submission = {
      open: (!opens || opens.getTime() <= now.getTime()) && (!lock || now.getTime() <= lock.getTime()),
      deadline: lock ? formatBrt(toDbTime(lock)) : null,
    };
  }

  return {
    hackathonId: h.id,
    phase,
    partner: h.partner,
    registrationUrl: h.registrationUrl,
    registrationClosed,
    requiresApproval: h.requiresApproval,
    full: !h.requiresApproval && cap.capacity !== null && cap.remaining === 0,
    signedIn: member !== null,
    status,
    waitlistPosition: position,
    helping: helpingEntry ? { kind: helpingEntry[0], status: helpingEntry[1] } : null,
    rsvp,
    rsvpConfirmed: rsvpRow?.rsvpStatus === "confirmed",
    checkedIn: !!ticket?.checkedInAt,
    hasTeam: entry !== null || (member && approved ? await hasTeam(h.id, member.username) : false),
    submission,
    entry: entry ? { status: entry.status } : null,
    stageLive: stage?.status === "live",
    npsPending,
    certificateCode: certificate?.code ?? null,
  };
}

async function hasTeam(hackathonId: string, username: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM teams t JOIN team_members tm ON tm.teamId = t.id
       WHERE t.hackathonId = ? AND tm.username = ? LIMIT 1`,
    )
    .get(hackathonId, username);
  return Boolean(row);
}

async function npsIsPending(hackathonId: string, memberId: number, now: Date): Promise<boolean> {
  const w = await getNpsWindow(hackathonId);
  if (!w || npsPhase(w, now) !== "aberta") return false;
  const [role, mine] = await Promise.all([npsRoleFor(hackathonId, memberId), getMyNps(hackathonId, memberId)]);
  return role !== null && mine === null;
}

export async function getNextStep(
  h: Hackathon,
  member: Pick<Member, "id" | "username"> | null,
  now = new Date(),
): Promise<NextStep> {
  return nextStep(await getNextStepFacts(h, member, now));
}

/**
 * Edições em que a pessoa está na jornada (inscrição em qualquer estado ou
 * candidatura ativa pra ajudar) e que ainda não viraram arquivo — o
 * encerramento recente fica (certificado, NPS). Mais próxima primeiro.
 */
export async function listMyActiveEditions(memberId: number, now = new Date()): Promise<Hackathon[]> {
  const ids = await db
    .prepare(
      `SELECT hackathonId FROM registrations WHERE memberId = ?
       UNION
       SELECT hackathonId FROM role_applications WHERE memberId = ? AND status <> 'rejected'`,
    )
    .all<{ hackathonId: string }>(memberId, memberId);
  const editions = (await Promise.all(ids.map((r) => getHackathon(r.hackathonId)))).filter(
    (h): h is Hackathon => !!h && h.active && editionPhase(h, now) !== "archived",
  );
  return editions.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}
