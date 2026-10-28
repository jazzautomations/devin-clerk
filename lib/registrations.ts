import db from "@/lib/db";
import { XP, type Badge } from "@/lib/game";
import { awardXp, checkBadges, mintCard } from "@/lib/xp";
import { notify } from "@/lib/notifications";
import { queueTicketEmail } from "@/lib/ticketEmail";
import { parseEventTime } from "@/lib/eventTime";
import { deactivateBoardEntry } from "@/lib/teamboard";
import { leaveEditionTeam } from "@/lib/teams";

// avatarUrl é coluna de lib/members — garante o ALTER aqui pra quem importa
// este módulo sem passar por members.ts
// spec 032 — "pedir lugar" (apply to attend): edições curadas guardam a
// inscrição como 'pending' e a recompensa só existe na aprovação do admin.
// requiresApproval mora em hackathons; status/reviewedAt em registrations —
// este arquivo é o dono do schema de inscrição (lib/db.ts não é tocado).
export type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlist";

/** cancelamento recusado — a rota devolve status + mensagem */
export class RegistrationError extends Error {
  constructor(
    readonly code: "rejected" | "event_started" | "checked_in",
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function editionRequiresApproval(hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT requiresApproval FROM hackathons WHERE id = ?")
    .get(hackathonId) as { requiresApproval: number } | undefined;
  return row?.requiresApproval === 1;
}

// ---------- vagas + fila de espera (spec 033 FR-009) ----------
// capacity NULL = sem limite; só 'approved' ocupa vaga. Quem chega com a
// edição cheia entra como 'waitlist' (sem carta/XP, fora dos gates — mesma
// regra de 'pending'). Toda decisão que olha a contagem roda numa transação
// com a linha da edição travada (SELECT … FOR UPDATE): duas inscrições
// simultâneas não ocupam a mesma última vaga.

export type Promoted = { memberId: number; username: string; email: string; promotedAt: string };

type EditionLock = {
  capacity: number | null;
  requiresApproval: number;
  rsvpEnabled: number;
  overbookPercent: number;
};

/**
 * Sobrevenda (spec 037 Onda 1 #1, migration 012): com RSVP ligado, a
 * decisão de aprovação usa capacidade × (1 + overbook%), arredondada pra
 * baixo — quem recusa/expira no RSVP devolve vaga pra fila. A capacidade
 * pública (getEditionCapacity) continua a real.
 */
export function effectiveCapacity(e: Pick<EditionLock, "capacity" | "rsvpEnabled" | "overbookPercent">): number | null {
  if (e.capacity === null) return null;
  if (e.rsvpEnabled !== 1 || !(e.overbookPercent > 0)) return e.capacity;
  return Math.floor((e.capacity * (100 + e.overbookPercent)) / 100);
}

// capacity devolvida já é a efetiva (com sobrevenda quando houver)
async function lockEdition(hackathonId: string): Promise<EditionLock | undefined> {
  const row = await db
    .prepare(
      "SELECT capacity, requiresApproval, rsvpEnabled, overbookPercent FROM hackathons WHERE id = ? FOR UPDATE",
    )
    .get<EditionLock>(hackathonId);
  return row && { ...row, capacity: effectiveCapacity(row) };
}

async function countApproved(hackathonId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM registrations WHERE hackathonId = ? AND status = 'approved'")
    .get<{ n: number }>(hackathonId);
  return row?.n ?? 0;
}

async function hasFreeSpot(hackathonId: string, capacity: number | null): Promise<boolean> {
  return capacity === null || (await countApproved(hackathonId)) < capacity;
}

// promove a fila (ordem de chegada na fila) enquanto houver vaga. Chamar
// SÓ dentro de transação com a edição travada. A promoção paga a recompensa
// completa (mesma porta do register/aprovação) e deixa promotedAt marcado —
// é o hook do aviso por e-mail (frente D lê listPromotions).
async function fillFromWaitlist(hackathonId: string, capacity: number | null): Promise<Promoted[]> {
  const promoted: Promoted[] = [];
  while (await hasFreeSpot(hackathonId, capacity)) {
    const next = await db
      .prepare(
        `SELECT r.id, r.memberId FROM registrations r
         WHERE r.hackathonId = ? AND r.status = 'waitlist'
         ORDER BY r.waitlistedAt, r.id LIMIT 1 FOR UPDATE`,
      )
      .get<{ id: number; memberId: number }>(hackathonId);
    if (!next) break;
    const row = await db
      .prepare(
        `UPDATE registrations SET status = 'approved', promotedAt = datetime('now')
         WHERE id = ? RETURNING promotedAt`,
      )
      .get<{ promotedAt: string }>(next.id);
    await completeRegistration(next.memberId, hackathonId);
    await queueTicketEmail(next.memberId, hackathonId);
    const m = await db
      .prepare("SELECT username, email FROM members WHERE id = ?")
      .get<{ username: string; email: string }>(next.memberId);
    await notify(next.memberId, {
      type: "waitlist_promoted",
      text: "abriu vaga: sua inscrição saiu da fila de espera e está confirmada",
      href: `/h/${hackathonId}`,
    });
    promoted.push({
      memberId: next.memberId,
      username: m?.username ?? "",
      email: m?.email ?? "",
      promotedAt: row?.promotedAt ?? "",
    });
  }
  return promoted;
}

export async function getEditionCapacity(hackathonId: string): Promise<{
  capacity: number | null;
  approved: number;
  waitlist: number;
  remaining: number | null;
}> {
  const row = await db
    .prepare(
      `SELECT h.capacity,
         (SELECT COUNT(*) FROM registrations r WHERE r.hackathonId = h.id AND r.status = 'approved') AS approved,
         (SELECT COUNT(*) FROM registrations r WHERE r.hackathonId = h.id AND r.status = 'waitlist') AS waitlist
       FROM hackathons h WHERE h.id = ?`,
    )
    .get<{ capacity: number | null; approved: number; waitlist: number }>(hackathonId);
  const capacity = row?.capacity ?? null;
  const approved = row?.approved ?? 0;
  return {
    capacity,
    approved,
    waitlist: row?.waitlist ?? 0,
    remaining: capacity === null ? null : Math.max(0, capacity - approved),
  };
}

/** posição (1-based) na fila de espera, ou null se não está na fila */
export async function getWaitlistPosition(memberId: number, hackathonId: string): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM registrations o
               WHERE o.hackathonId = r.hackathonId AND o.status = 'waitlist'
                 AND (o.waitlistedAt < r.waitlistedAt
                      OR (o.waitlistedAt = r.waitlistedAt AND o.id <= r.id))) AS pos
       FROM registrations r
       WHERE r.memberId = ? AND r.hackathonId = ? AND r.status = 'waitlist'`,
    )
    .get<{ pos: number }>(memberId, hackathonId);
  return row ? row.pos : null;
}

/** organizador define a capacidade; aumentar (ou tirar o limite) promove a fila na hora */
export async function setEditionCapacity(
  hackathonId: string,
  capacity: number | null,
): Promise<{ promoted: Promoted[] }> {
  return db.transaction(async () => {
    const ed = await lockEdition(hackathonId);
    if (!ed) return { promoted: [] };
    await db.prepare("UPDATE hackathons SET capacity = ? WHERE id = ?").run(capacity, hackathonId);
    return { promoted: await fillFromWaitlist(hackathonId, effectiveCapacity({ ...ed, capacity })) };
  })();
}

/** promove a fila até a capacidade efetiva — usado quando a sobrevenda do RSVP aumenta */
export async function refillFromWaitlist(hackathonId: string): Promise<Promoted[]> {
  return db.transaction(async () => {
    const ed = await lockEdition(hackathonId);
    return ed ? fillFromWaitlist(hackathonId, ed.capacity) : [];
  })();
}

/** hook da frente D (aviso por e-mail): quem saiu da fila, mais antigos primeiro */
export async function listPromotions(hackathonId: string, since?: string): Promise<Promoted[]> {
  return db
    .prepare(
      `SELECT r.memberId, m.username, m.email, r.promotedAt
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ? AND r.promotedAt IS NOT NULL
         AND (?::text IS NULL OR to_ts(r.promotedAt) > to_ts(?::text))
       ORDER BY r.promotedAt, r.id`,
    )
    .all<Promoted>(hackathonId, since ?? null, since ?? null);
}

// o pedido entra como 'pending' quando a edição é curada — a recompensa
// NÃO acontece aqui: completeRegistration é a única porta (register
// instantâneo em edição aberta, ou aprovação admin via reviewRegistration).
// Inscrição existente preserva o status: re-pedido em 'pending' não
// duplica, e em 'rejected' não reabre a fila — quem decide é o admin.
// Edição aberta com capacidade cheia → 'waitlist' com posição.
export async function register(
  memberId: number,
  hackathonId: string,
): Promise<{ status: RegistrationStatus; created: boolean; position: number | null }> {
  return db.transaction(async () => {
    const ed = await lockEdition(hackathonId);
    const existing = await getRegistrationStatus(memberId, hackathonId);
    if (existing) {
      return {
        status: existing,
        created: false,
        position: existing === "waitlist" ? await getWaitlistPosition(memberId, hackathonId) : null,
      };
    }
    const wants: RegistrationStatus =
      ed?.requiresApproval === 1
        ? "pending"
        : (await hasFreeSpot(hackathonId, ed?.capacity ?? null))
          ? "approved"
          : "waitlist";
    await db
      .prepare(
        `INSERT INTO registrations (memberId, hackathonId, status, waitlistedAt)
         VALUES (?, ?, ?, CASE WHEN ?::text = 'waitlist' THEN datetime('now') END)`,
      )
      .run(memberId, hackathonId, wants, wants);
    // inscrição direta em edição aberta: aprovada na hora → e-mail com o QR
    if (wants === "approved") await queueTicketEmail(memberId, hackathonId);
    return {
      status: wants,
      created: true,
      position: wants === "waitlist" ? await getWaitlistPosition(memberId, hackathonId) : null,
    };
  })();
}

/**
 * Quem perde a inscrição sai do que dependia dela na edição: do time (o time
 * é avisado), dos convites de time pendentes e do anúncio "procuro time".
 * Sem isso o time ficava preso com um integrante sem inscrição e não
 * conseguia enviar a entrega.
 */
export async function dropFromEdition(
  memberId: number,
  hackathonId: string,
  kind: "sem_inscricao" | "conta_excluida" = "sem_inscricao",
): Promise<void> {
  const m = await db.prepare("SELECT username FROM members WHERE id = ?").get<{ username: string }>(memberId);
  if (m) await leaveEditionTeam(hackathonId, m.username, { kind });
  await db
    .prepare(
      `UPDATE team_invites SET status = 'cancelled', respondedAt = sqlite_now()
       WHERE memberId = ? AND hackathonId = ? AND status = 'pending'`,
    )
    .run(memberId, hackathonId);
  await deactivateBoardEntry(memberId, hackathonId);
}

const hasStarted = (startsAt: string | null | undefined, now: Date) => {
  const start = parseEventTime(startsAt);
  return !!start && now.getTime() >= start.getTime();
};

/**
 * Cancelar a própria inscrição (botão do participante e exclusão de conta).
 * Recusa (RegistrationError, 409):
 *  - inscrição recusada: a decisão é da organização, a linha fica;
 *  - edição já começou: a vaga não volta pra fila com o evento rolando;
 *  - check-in feito: a presença é registro do evento.
 * Passando, faz o mesmo que `unregister`.
 */
export async function cancelRegistration(
  memberId: number,
  hackathonId: string,
  now = new Date(),
  dropKind: "sem_inscricao" | "conta_excluida" = "sem_inscricao",
): Promise<{ promoted: Promoted[] }> {
  return db.transaction(async () => {
    await lockEdition(hackathonId);
    const reg = await db
      .prepare(
        `SELECT r.status, h.startsAt,
                EXISTS (SELECT 1 FROM checkins c WHERE c.registrationId = r.id) AS "checkedIn"
         FROM registrations r JOIN hackathons h ON h.id = r.hackathonId
         WHERE r.memberId = ? AND r.hackathonId = ? FOR UPDATE OF r`,
      )
      .get<{ status: RegistrationStatus; startsAt: string; checkedIn: boolean }>(memberId, hackathonId);
    if (!reg) return { promoted: [] };
    if (reg.status === "rejected") {
      throw new RegistrationError("rejected", "a organização recusou esta inscrição; só ela pode mudar isso");
    }
    if (reg.checkedIn) {
      throw new RegistrationError("checked_in", "você já fez check-in nesta edição; fale com a organização");
    }
    if (hasStarted(reg.startsAt, now)) {
      throw new RegistrationError("event_started", "a edição já começou; não dá mais pra cancelar a inscrição");
    }
    return unregister(memberId, hackathonId, dropKind);
  })();
}

/**
 * Libera a vaga sem regra de quem pede: apaga a inscrição, tira a pessoa do
 * que dependia dela na edição (time, convites, "procuro time") e, se ela
 * era aprovada, sobe o 1º da fila na mesma transação. Nunca lança erro de
 * regra: quem chama já decidiu (o RSVP checa o início com o próprio
 * relógio; o cancelamento do participante passa por `cancelRegistration`).
 * Respostas do formulário e termos caem junto (CASCADE); a recompensa já
 * paga fica (registration_rewards), então se inscrever de novo não paga
 * outra vez.
 */
export async function unregister(
  memberId: number,
  hackathonId: string,
  dropKind: "sem_inscricao" | "conta_excluida" = "sem_inscricao",
): Promise<{ promoted: Promoted[] }> {
  return db.transaction(async () => {
    const ed = await lockEdition(hackathonId);
    const gone = await db
      .prepare(`DELETE FROM registrations WHERE memberId = ? AND hackathonId = ? RETURNING status`)
      .get<{ status: RegistrationStatus }>(memberId, hackathonId);
    if (!gone) return { promoted: [] };
    await dropFromEdition(memberId, hackathonId, dropKind);
    if (!ed || gone.status !== "approved") return { promoted: [] };
    return { promoted: await fillFromWaitlist(hackathonId, ed.capacity) };
  })();
}

export async function getRegistrationStatus(
  memberId: number,
  hackathonId: string,
): Promise<RegistrationStatus | null> {
  const row = await db
    .prepare(
      "SELECT status FROM registrations WHERE memberId = ? AND hackathonId = ?",
    )
    .get(memberId, hackathonId) as { status: RegistrationStatus } | undefined;
  return row?.status ?? null;
}

// "inscrito" = approved — TODOS os gates (board 012, team 021, mural 028,
// dashboard, perfil público) herdam daqui; pendente é candidato, não inscrito
export async function getRegistrationIds(memberId: number): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT hackathonId FROM registrations
       WHERE memberId = ? AND status = 'approved'`,
    )
    .all(memberId) as { hackathonId: string }[];
  return rows.map((r) => r.hackathonId);
}

export async function getRegistrationsForMember(memberId: number): Promise<string[]> {
  return getRegistrationIds(memberId);
}

// lista PÚBLICA da edição (/h/[id] "inscritos") — só aprovados que
// ESCOLHERAM aparecer (frente N #6, migration 016). O aceite LGPD da
// inscrição cobre "organizar o evento", não exibir quem se inscreveu: a
// exibição é opt-in explícito (publicListing), padrão não aparecer. A
// contagem pública usa getEditionCapacity (agregado, sem dado pessoal).
// pendente/rejeitado/fila nunca vazam.
export async function getRegistrationsByHackathon(
  hackathonId: string,
): Promise<{
  username: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}[]> {
  return await db
    .prepare(
      `SELECT m.username, m.name, m.avatarUrl, r.createdAt
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ? AND r.status = 'approved' AND r.publicListing = 1
       ORDER BY r.createdAt`,
    )
    .all(hackathonId) as {
    username: string;
    name: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }[];
}

/** opt-in/opt-out da lista pública; false quando não há inscrição */
export async function setPublicListing(memberId: number, hackathonId: string, on: boolean): Promise<boolean> {
  const r = await db
    .prepare("UPDATE registrations SET publicListing = ? WHERE memberId = ? AND hackathonId = ?")
    .run(on ? 1 : 0, memberId, hackathonId);
  return r.changes > 0;
}

export async function getPublicListing(memberId: number, hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT publicListing FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ publicListing: number }>(memberId, hackathonId);
  return row?.publicListing === 1;
}

// a recompensa da inscrição efetivada — ÚNICO caminho de XP + carta +
// badges de inscrição: o register instantâneo (edição aberta) e a
// aprovação admin (edição curada) passam por aqui; pendente nunca chega.
// Paga uma vez só por (membro, edição): cancelar e se inscrever de novo
// não rende outro +50 (registration_rewards, migration 020).
export async function completeRegistration(
  memberId: number,
  hackathonId: string,
): Promise<{ xp: string; cardSerial: number | null; newBadges: Badge[]; rewarded: boolean }> {
  const first = await db
    .prepare(
      `INSERT INTO registration_rewards (memberId, hackathonId) VALUES (?, ?)
       ON CONFLICT DO NOTHING RETURNING memberId`,
    )
    .get(memberId, hackathonId);
  if (!first) return { xp: "+0", cardSerial: null, newBadges: [], rewarded: false };
  // XP.register = 0 desde a spec 046 (nível vem de fato verificado); o campo
  // xp fica "+0" pelo contrato das rotas
  await awardXp(memberId, XP.register);
  const cardSerial = await mintCard(memberId, hackathonId);
  const newBadges = await checkBadges(memberId);
  return { xp: `+${XP.register}`, cardSerial, newBadges, rewarded: true };
}

export type ReviewResult =
  | {
      status: "approved";
      rewarded: boolean;
      xp: string;
      cardSerial: number | null;
      newBadges: Badge[];
    }
  | { status: "rejected"; promoted: Promoted[] }
  | { status: "waitlist"; position: number | null };

// decisão do admin sobre o pedido (spec 032). approve: a transição
// não-aprovado → aprovado dispara completeRegistration (que paga uma vez só
// por membro+edição). Com a edição cheia (spec 033 FR-009) o aprovado vai
// pra fila de espera e sobe sozinho quando abrir vaga. reject: marca
// 'rejected' (inclusive revogação de quem já era aprovado — carta/XP pagos
// NÃO são estornados; a vaga volta pra fila se o evento não começou) e tira
// a pessoa do time; a linha fica como registro honesto da decisão.
// Toda decisão vira notificação pra pessoa (o e-mail do ingresso depende do
// driver; o aviso na plataforma não).
// null = não existe inscrição pro par memberId+edição → a rota mapeia 404.
export async function reviewRegistration(
  memberId: number,
  hackathonId: string,
  action: "approve" | "reject",
  now = new Date(),
): Promise<ReviewResult | null> {
  return db.transaction(async (): Promise<ReviewResult | null> => {
    const ed = await lockEdition(hackathonId);
    const status = await getRegistrationStatus(memberId, hackathonId);
    if (status === null) return null;
    const h = await db
      .prepare("SELECT name, startsAt FROM hackathons WHERE id = ?")
      .get<{ name: string; startsAt: string }>(hackathonId);
    const name = h?.name ?? "a edição";
    if (action === "reject") {
      await db.prepare(
        `UPDATE registrations
         SET status = 'rejected', reviewedAt = datetime('now')
         WHERE memberId = ? AND hackathonId = ?`,
      ).run(memberId, hackathonId);
      await dropFromEdition(memberId, hackathonId);
      if (status !== "rejected") {
        await notify(memberId, {
          type: "registration_rejected",
          text: `sua inscrição em ${name} não foi aprovada desta vez. Outras edições abertas estão no radar.`,
          href: "/radar",
        });
      }
      const promoted =
        status === "approved" && ed && !hasStarted(h?.startsAt, now)
          ? await fillFromWaitlist(hackathonId, ed.capacity)
          : [];
      return { status: "rejected", promoted };
    }
    if (status === "approved") {
      return {
        status: "approved",
        rewarded: false,
        xp: "+0",
        cardSerial: null,
        newBadges: [],
      };
    }
    if (!(await hasFreeSpot(hackathonId, ed?.capacity ?? null))) {
      await db.prepare(
        `UPDATE registrations
         SET status = 'waitlist', reviewedAt = datetime('now'),
             waitlistedAt = COALESCE(waitlistedAt, datetime('now'))
         WHERE memberId = ? AND hackathonId = ?`,
      ).run(memberId, hackathonId);
      const position = await getWaitlistPosition(memberId, hackathonId);
      if (status !== "waitlist") {
        await notify(memberId, {
          type: "registration_waitlist",
          text: `sua inscrição em ${name} foi aprovada e entrou na fila de espera${position ? ` (#${position})` : ""}, porque as vagas acabaram. Se abrir vaga, ela é confirmada sozinha.`,
          href: `/h/${hackathonId}/inscricao`,
        });
      }
      return { status: "waitlist", position };
    }
    await db.prepare(
      `UPDATE registrations
       SET status = 'approved', reviewedAt = datetime('now')
       WHERE memberId = ? AND hackathonId = ?`,
    ).run(memberId, hackathonId);
    const reward = await completeRegistration(memberId, hackathonId);
    await queueTicketEmail(memberId, hackathonId);
    await notify(memberId, {
      type: "registration_approved",
      text: `sua inscrição em ${name} foi aprovada. Seu ingresso já está disponível.`,
      href: `/h/${hackathonId}/ingresso`,
    });
    return { status: "approved", ...reward };
  })();
}

// versão operacional (admin): inclui e-mail + memberId + status da fila de
// curadoria — nunca usar em rota pública. Pendentes primeiro: é a fila de
// trabalho do organizador.
export async function listRegistrants(
  hackathonId: string,
): Promise<{
  memberId: number;
  username: string;
  name: string | null;
  email: string;
  status: RegistrationStatus;
  createdAt: string;
  reviewedAt: string | null;
}[]> {
  return await db
    .prepare(
      `SELECT r.memberId, m.username, m.name, m.email, r.status,
              r.createdAt, r.reviewedAt
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ?
       ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'waitlist' THEN 1 ELSE 2 END,
                CASE WHEN r.status = 'waitlist' THEN r.waitlistedAt END,
                r.createdAt, r.id`,
    )
    .all(hackathonId) as {
    memberId: number;
    username: string;
    name: string | null;
    email: string;
    status: RegistrationStatus;
    createdAt: string;
    reviewedAt: string | null;
  }[];
}
