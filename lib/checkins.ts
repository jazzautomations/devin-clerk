import { createHmac, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import type { RegistrationStatus } from "@/lib/registrations";

// Check-in no dia (spec 033 US4). O QR do ingresso carrega um token
// assinado — HMAC-SHA256 do registrationId com HACKAHUB_TICKET_SECRET —
// e nunca o id cru: quem não tem o segredo não forja nem enumera ingresso.
// Como o token não carrega o id, a verificação compara contra as inscrições
// DA EDIÇÃO que está fazendo o check-in (centenas de linhas, barato); token
// de outra edição simplesmente não bate.
// Presença é o que vale pra certificado (frente C usa isCheckedIn /
// listCheckins). XP e carta continuam na inscrição — não mexemos aqui.

const TOKEN_PREFIX = "HH1.";
const TOKEN_RE = /^HH1\.[A-Za-z0-9_-]{43}$/;
const DEV_SECRET = "hackahub-dev-ticket-secret-nao-usar-em-producao";

export function ticketSecret(): string {
  const s = process.env.HACKAHUB_TICKET_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("HACKAHUB_TICKET_SECRET ausente — obrigatório em produção");
  }
  return DEV_SECRET;
}

export function ticketToken(registrationId: number): string {
  const mac = createHmac("sha256", ticketSecret()).update(String(registrationId)).digest("base64url");
  return TOKEN_PREFIX + mac;
}

export function isTicketTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

type RegRow = {
  id: number;
  memberId: number;
  hackathonId: string;
  status: RegistrationStatus;
  username: string;
  name: string | null;
};

const REG_SELECT = `SELECT r.id, r.memberId, r.hackathonId, r.status, m.username, m.name
  FROM registrations r JOIN members m ON m.id = r.memberId`;

export async function findRegistrationByToken(
  hackathonId: string,
  token: string,
): Promise<RegRow | null> {
  if (!isTicketTokenShape(token)) return null;
  const given = Buffer.from(token);
  const rows = await db.prepare(`${REG_SELECT} WHERE r.hackathonId = ?`).all<RegRow>(hackathonId);
  for (const r of rows) {
    const expected = Buffer.from(ticketToken(r.id));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return r;
  }
  return null;
}

export type CheckInResult =
  | {
      ok: true;
      already: boolean;
      at: string;
      registrationId: number;
      memberId: number;
      username: string;
      name: string | null;
    }
  | { ok: false; reason: "invalid" | "not_found" }
  | { ok: false; reason: "pending" | "rejected" | "waitlist"; username: string; name: string | null };

/**
 * Marca presença. Idempotente: a segunda leitura devolve already=true com
 * o horário da primeira. Só inscrição aprovada da própria edição entra.
 */
export async function checkIn(
  hackathonId: string,
  by: { token: string } | { registrationId: number },
  byMemberId: number | null,
): Promise<CheckInResult> {
  let reg: RegRow | null;
  if ("token" in by) {
    if (!isTicketTokenShape(by.token)) return { ok: false, reason: "invalid" };
    reg = await findRegistrationByToken(hackathonId, by.token);
  } else {
    if (!Number.isSafeInteger(by.registrationId) || by.registrationId <= 0) {
      return { ok: false, reason: "invalid" };
    }
    reg =
      (await db
        .prepare(`${REG_SELECT} WHERE r.id = ? AND r.hackathonId = ?`)
        .get<RegRow>(by.registrationId, hackathonId)) ?? null;
  }
  if (!reg) return { ok: false, reason: "not_found" };
  if (reg.status !== "approved") {
    return { ok: false, reason: reg.status, username: reg.username, name: reg.name };
  }
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO checkins (registrationId, byMemberId, via, syncedAt)
       VALUES (?, ?, 'online', datetime('now'))`,
    )
    .run(reg.id, byMemberId);
  const row = await db
    .prepare("SELECT at FROM checkins WHERE registrationId = ?")
    .get<{ at: string }>(reg.id);
  return {
    ok: true,
    already: res.changes === 0,
    at: row!.at,
    registrationId: reg.id,
    memberId: reg.memberId,
    username: reg.username,
    name: reg.name,
  };
}

export async function isCheckedIn(registrationId: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM checkins WHERE registrationId = ?")
    .get(registrationId);
  return Boolean(row);
}

export type CheckinEntry = {
  registrationId: number;
  memberId: number;
  username: string;
  name: string | null;
  at: string;
  byMemberId: number | null;
};

export async function listCheckins(hackathonId: string): Promise<CheckinEntry[]> {
  return db
    .prepare(
      `SELECT c.registrationId, r.memberId, m.username, m.name, c.at, c.byMemberId
       FROM checkins c
       JOIN registrations r ON r.id = c.registrationId
       JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ?
       ORDER BY c.at DESC, c.registrationId DESC`,
    )
    .all<CheckinEntry>(hackathonId);
}

export type CheckinCounts = { inscritos: number; aprovados: number; presentes: number };

export async function checkinCounts(hackathonId: string): Promise<CheckinCounts> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*)::int AS inscritos,
         (COUNT(*) FILTER (WHERE r.status = 'approved'))::int AS aprovados,
         (COUNT(c.registrationId) FILTER (WHERE r.status = 'approved'))::int AS presentes
       FROM registrations r LEFT JOIN checkins c ON c.registrationId = r.id
       WHERE r.hackathonId = ?`,
    )
    .get<CheckinCounts>(hackathonId);
  return {
    inscritos: Number(row?.inscritos ?? 0),
    aprovados: Number(row?.aprovados ?? 0),
    presentes: Number(row?.presentes ?? 0),
  };
}

export type RegistrantHit = {
  registrationId: number;
  memberId: number;
  username: string;
  name: string | null;
  email: string;
  status: RegistrationStatus;
  checkedInAt: string | null;
};

/** busca manual do staff (sem câmera): nome, e-mail ou username, só na edição */
export async function searchRegistrants(
  hackathonId: string,
  query: string,
  limit = 20,
): Promise<RegistrantHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length === 0) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `SELECT r.id AS registrationId, r.memberId, m.username, m.name, m.email,
              r.status, c.at AS checkedInAt
       FROM registrations r
       JOIN members m ON m.id = r.memberId
       LEFT JOIN checkins c ON c.registrationId = r.id
       WHERE r.hackathonId = @h
         AND (m.username LIKE @q ESCAPE '\\' OR m.name LIKE @q ESCAPE '\\'
              OR m.email LIKE @q ESCAPE '\\')
       ORDER BY m.name NULLS LAST, m.username
       LIMIT @limit`,
    )
    .all<RegistrantHit>({ h: hackathonId, q: like, limit });
}

export type Ticket = {
  registrationId: number;
  status: RegistrationStatus;
  token: string;
  checkedInAt: string | null;
};

export async function getTicket(memberId: number, hackathonId: string): Promise<Ticket | null> {
  const row = await db
    .prepare(
      `SELECT r.id AS registrationId, r.status, c.at AS checkedInAt
       FROM registrations r LEFT JOIN checkins c ON c.registrationId = r.id
       WHERE r.memberId = ? AND r.hackathonId = ?`,
    )
    .get<Omit<Ticket, "token">>(memberId, hackathonId);
  if (!row) return null;
  return { ...row, token: ticketToken(row.registrationId) };
}

/** "14:05" no fuso do evento — datas do banco são UTC `YYYY-MM-DD HH:MM:SS` */
export function formatCheckinTime(at: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(at.replace(" ", "T") + "Z"));
}
