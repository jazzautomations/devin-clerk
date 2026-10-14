import db from "@/lib/db";
import { XP, type Badge } from "@/lib/game";
import { awardXp, checkBadges, mintCard } from "@/lib/xp";
import { notify } from "@/lib/notifications";
import { queueTicketEmail } from "@/lib/ticketEmail";

// avatarUrl é coluna de lib/members — garante o ALTER aqui pra quem importa
// este módulo sem passar por members.ts
// spec 032 — "pedir lugar" (apply to attend): edições curadas guardam a
// inscrição como 'pending' e a recompensa só existe na aprovação do admin.
// requiresApproval mora em hackathons; status/reviewedAt em registrations —
// este arquivo é o dono do schema de inscrição (lib/db.ts não é tocado).
export type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlist";

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
      text: "abriu vaga: tua inscrição saiu da fila de espera e está confirmada",
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

// cancelar libera a vaga: se quem saiu era aprovado, o 1º da fila sobe
// na mesma transação. Respostas do formulário caem junto (CASCADE).
export async function unregister(
  memberId: number,
  hackathonId: string,
): Promise<{ promoted: Promoted[] }> {
  return db.transaction(async () => {
    const ed = await lockEdition(hackathonId);
    const gone = await db
      .prepare(
        `DELETE FROM registrations WHERE memberId = ? AND hackathonId = ? RETURNING status`,
      )
      .get<{ status: RegistrationStatus }>(memberId, hackathonId);
    if (!ed || gone?.status !== "approved") return { promoted: [] };
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

// lista PÚBLICA da edição (/h/[id] "inscritos" + contagem da arena) —
// só aprovados aparecem e contam; pendente/rejeitado não vaza
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
       WHERE r.hackathonId = ? AND r.status = 'approved'
       ORDER BY r.createdAt`,
    )
    .all(hackathonId) as {
    username: string;
    name: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }[];
}

// a recompensa da inscrição efetivada — ÚNICO caminho de XP + carta +
// badges de inscrição: o register instantâneo (edição aberta) e a
// aprovação admin (edição curada) passam por aqui; pendente nunca chega
export async function completeRegistration(
  memberId: number,
  hackathonId: string,
): Promise<{ xp: string; cardSerial: number | null; newBadges: Badge[] }> {
  await awardXp(memberId, XP.register);
  const cardSerial = await mintCard(memberId, hackathonId);
  const newBadges = await checkBadges(memberId);
  return { xp: `+${XP.register}`, cardSerial, newBadges };
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
// não-aprovado → aprovado dispara completeRegistration UMA vez — re-approve
// é no-op sem recompensa (awardXp não é idempotente). Com a edição cheia
// (spec 033 FR-009) o aprovado vai pra fila de espera e sobe sozinho quando
// abrir vaga. reject: marca 'rejected' (inclusive revogação de quem já era
// aprovado — carta/XP pagos NÃO são estornados, mas a vaga volta pra fila);
// a linha fica como registro honesto da decisão.
// null = não existe inscrição pro par memberId+edição → a rota mapeia 404.
export async function reviewRegistration(
  memberId: number,
  hackathonId: string,
  action: "approve" | "reject",
): Promise<ReviewResult | null> {
  return db.transaction(async (): Promise<ReviewResult | null> => {
    const ed = await lockEdition(hackathonId);
    const status = await getRegistrationStatus(memberId, hackathonId);
    if (status === null) return null;
    if (action === "reject") {
      await db.prepare(
        `UPDATE registrations
         SET status = 'rejected', reviewedAt = datetime('now')
         WHERE memberId = ? AND hackathonId = ?`,
      ).run(memberId, hackathonId);
      const promoted =
        status === "approved" && ed ? await fillFromWaitlist(hackathonId, ed.capacity) : [];
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
      return { status: "waitlist", position: await getWaitlistPosition(memberId, hackathonId) };
    }
    await db.prepare(
      `UPDATE registrations
       SET status = 'approved', reviewedAt = datetime('now')
       WHERE memberId = ? AND hackathonId = ?`,
    ).run(memberId, hackathonId);
    const reward = await completeRegistration(memberId, hackathonId);
    await queueTicketEmail(memberId, hackathonId);
    return { status: "approved", rewarded: true, ...reward };
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
