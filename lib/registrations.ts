import db from "@/lib/db";
import { XP, type Badge } from "@/lib/game";
import { awardXp, checkBadges, mintCard } from "@/lib/xp";

// avatarUrl é coluna de lib/members — garante o ALTER aqui pra quem importa
// este módulo sem passar por members.ts
// spec 032 — "pedir lugar" (apply to attend): edições curadas guardam a
// inscrição como 'pending' e a recompensa só existe na aprovação do admin.
// requiresApproval mora em hackathons; status/reviewedAt em registrations —
// este arquivo é o dono do schema de inscrição (lib/db.ts não é tocado).
export type RegistrationStatus = "pending" | "approved" | "rejected";

export async function editionRequiresApproval(hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT requiresApproval FROM hackathons WHERE id = ?")
    .get(hackathonId) as { requiresApproval: number } | undefined;
  return row?.requiresApproval === 1;
}

// o pedido entra como 'pending' quando a edição é curada — a recompensa
// NÃO acontece aqui: completeRegistration é a única porta (register
// instantâneo em edição aberta, ou aprovação admin via reviewRegistration).
// INSERT OR IGNORE preserva o status existente: re-pedido em 'pending' não
// duplica, e em 'rejected' não reabre a fila — quem decide é o admin.
export async function register(
  memberId: number,
  hackathonId: string,
): Promise<{ status: RegistrationStatus; created: boolean }> {
  const wants: RegistrationStatus = await editionRequiresApproval(hackathonId)
    ? "pending"
    : "approved";
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO registrations (memberId, hackathonId, status)
       VALUES (?, ?, ?)`,
    )
    .run(memberId, hackathonId, wants);
  const stored = await getRegistrationStatus(memberId, hackathonId) ?? wants;
  return { status: stored, created: res.changes > 0 };
}

export async function unregister(memberId: number, hackathonId: string): Promise<void> {
  await db.prepare(
    `DELETE FROM registrations WHERE memberId = ? AND hackathonId = ?`,
  ).run(memberId, hackathonId);
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
  | { status: "rejected" };

// decisão do admin sobre o pedido (spec 032). approve: a transição
// não-aprovado → aprovado dispara completeRegistration UMA vez — re-approve
// é no-op sem recompensa (awardXp não é idempotente). reject: marca
// 'rejected' (inclusive revogação de quem já era aprovado — carta/XP pagos
// NÃO são estornados); a linha fica como registro honesto da decisão.
// null = não existe inscrição pro par memberId+edição → a rota mapeia 404.
export async function reviewRegistration(
  memberId: number,
  hackathonId: string,
  action: "approve" | "reject",
): Promise<ReviewResult | null> {
  const status = await getRegistrationStatus(memberId, hackathonId);
  if (status === null) return null;
  if (action === "reject") {
    await db.prepare(
      `UPDATE registrations
       SET status = 'rejected', reviewedAt = datetime('now')
       WHERE memberId = ? AND hackathonId = ?`,
    ).run(memberId, hackathonId);
    return { status: "rejected" };
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
  await db.prepare(
    `UPDATE registrations
     SET status = 'approved', reviewedAt = datetime('now')
     WHERE memberId = ? AND hackathonId = ?`,
  ).run(memberId, hackathonId);
  const reward = await completeRegistration(memberId, hackathonId);
  return { status: "approved", rewarded: true, ...reward };
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
       ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
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
