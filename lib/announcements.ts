import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { emailDriver } from "@/lib/notify/email";
import { whatsappDriver } from "@/lib/notify/whatsapp";
import { normalizeBrPhone } from "@/lib/notify/phone";
import { announcementUrls, renderAnnouncementEmail, renderAnnouncementWhatsapp } from "@/lib/notify/templates";
import type { DriverEnv, SendOutcome } from "@/lib/notify/types";

// Avisos da edição (spec 033 US2, FR-003). Publicar = 1 linha em
// announcements + fan-out de deliveries 'queued' (destinatário × canal) na
// mesma transação. O envio é de um worker (processDeliveries), chamado logo
// após publicar (after() do Next) e por cron, que reprocessa falha
// transitória com backoff até MAX_ATTEMPTS. A unique de deliveries é a
// idempotência: fan-out repetido é no-op e cada linha sai uma vez.

export const AUDIENCES = ["todos", "aprovados", "presentes", "time"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CHANNELS = ["inapp", "email", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];
export type DeliveryStatus = "queued" | "sent" | "failed" | "skipped";

/** 'lista' = destinatários explícitos (aviso automático da programação, 011) */
export type StoredAudience = Audience | "lista";

export const AUDIENCE_LABEL: Record<StoredAudience, string> = {
  todos: "todos os inscritos",
  aprovados: "só aprovados",
  presentes: "só quem fez check-in",
  time: "um time",
  lista: "os afetados (mudança na programação)",
};

export const MAX_ATTEMPTS = 3;
/** espera depois da tentativa n (1-based) que falhou; a última não reagenda */
const BACKOFF_MIN = [1, 5];
/** linha travada por worker que morreu volta pra fila depois disso */
const STALE_CLAIM_MIN = 10;

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

export type AnnouncementInput = {
  audience: Audience;
  teamId: number | null;
  title: string;
  body: string;
};

export function validateAnnouncementInput(raw: unknown): AnnouncementInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isAudience(b.audience)) throw new Error("público inválido");
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!title || title.length > 140) throw new Error("título obrigatório (até 140 caracteres)");
  if (!body || body.length > 5000) throw new Error("texto obrigatório (até 5000 caracteres)");
  let teamId: number | null = null;
  if (b.audience === "time") {
    teamId = Number(b.teamId);
    if (!Number.isInteger(teamId) || teamId <= 0) throw new Error("escolha o time");
  }
  return { audience: b.audience, teamId, title, body };
}

export type Recipient = {
  memberId: number;
  email: string;
  phone: string | null;
  whatsappOptIn: boolean;
};

type RecipientRow = Omit<Recipient, "whatsappOptIn"> & { whatsappOptIn: number };

/**
 * Quem recebe. todos = approved + pending (rejected/waitlist ficam fora);
 * aprovados = approved; presentes = approved com check-in (tabela checkins
 * da frente A); time = membros do time, que tem que ser da edição.
 */
export async function recipientsFor(
  hackathonId: string,
  audience: Audience,
  teamId: number | null = null,
): Promise<Recipient[]> {
  const cols = "m.id AS memberId, m.email, m.phone, m.whatsappOptIn";
  let rows: RecipientRow[];
  if (audience === "time") {
    rows = await db
      .prepare(
        `SELECT DISTINCT ${cols}
         FROM team_members tm
         JOIN teams t ON t.id = tm.teamId
         JOIN members m ON m.username = tm.username
         WHERE t.id = ? AND t.hackathonId = ?
         ORDER BY m.id`,
      )
      .all<RecipientRow>(teamId, hackathonId);
  } else if (audience === "presentes") {
    rows = await db
      .prepare(
        `SELECT ${cols}
         FROM registrations r
         JOIN members m ON m.id = r.memberId
         WHERE r.hackathonId = ? AND r.status = 'approved'
           AND EXISTS (SELECT 1 FROM checkins c WHERE c.registrationId = r.id)
         ORDER BY m.id`,
      )
      .all<RecipientRow>(hackathonId);
  } else {
    const statuses = audience === "todos" ? ["approved", "pending"] : ["approved"];
    rows = await db
      .prepare(
        `SELECT ${cols}
         FROM registrations r
         JOIN members m ON m.id = r.memberId
         WHERE r.hackathonId = ? AND r.status IN (?, ?)
         ORDER BY m.id`,
      )
      .all<RecipientRow>(hackathonId, statuses[0], statuses[1] ?? statuses[0]);
  }
  return rows.map((r) => ({ ...r, whatsappOptIn: r.whatsappOptIn === 1 }));
}

/** canais de cada destinatário: zap só com opt-in + telefone validado */
function channelsFor(r: Recipient): Channel[] {
  const ch: Channel[] = ["inapp", "email"];
  if (r.whatsappOptIn && normalizeBrPhone(r.phone ?? "")) ch.push("whatsapp");
  return ch;
}

/** cria as deliveries que faltam; devolve quantas nasceram (0 = já feito) */
export async function fanOut(announcementId: number): Promise<number> {
  return db.transaction(async () => {
    const a = await db
      .prepare("SELECT hackathonId, audience, teamId FROM announcements WHERE id = ?")
      .get<{ hackathonId: string; audience: StoredAudience; teamId: number | null }>(announcementId);
    if (!a) throw new Error("aviso não encontrado");
    // 'lista' nasce com as deliveries prontas (publishToMembers)
    if (a.audience === "lista") return 0;
    const recipients = await recipientsFor(a.hackathonId, a.audience, a.teamId);
    let created = 0;
    const insert = db.prepare(
      `INSERT OR IGNORE INTO deliveries (announcementId, memberId, channel)
       VALUES (?, ?, ?)`,
    );
    for (const r of recipients) {
      for (const ch of channelsFor(r)) {
        created += (await insert.run(announcementId, r.memberId, ch)).changes;
      }
    }
    return created;
  })();
}

export async function publishAnnouncement(
  hackathonId: string,
  createdBy: number | null,
  input: AnnouncementInput,
): Promise<{ id: number; queued: number }> {
  return db.transaction(async () => {
    if (input.audience === "time") {
      const team = await db
        .prepare("SELECT 1 FROM teams WHERE id = ? AND hackathonId = ?")
        .get(input.teamId, hackathonId);
      if (!team) throw new Error("time não é desta edição");
    }
    const row = await db
      .prepare(
        `INSERT INTO announcements (hackathonId, audience, teamId, title, body, createdBy)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get<{ id: number }>(hackathonId, input.audience, input.teamId, input.title, input.body, createdBy);
    const queued = await fanOut(row!.id);
    return { id: row!.id, queued };
  })();
}

/**
 * Aviso pra uma lista explícita de membros (audience 'lista'). Mesmo
 * caminho de entrega do resto — deliveries 'queued' por canal, o worker
 * envia — só que o público é decidido por quem chama (ex.: só os mentores
 * afetados por uma mudança de programação).
 */
export async function publishToMembers(
  hackathonId: string,
  createdBy: number | null,
  content: { title: string; body: string },
  memberIds: number[],
): Promise<{ id: number; queued: number }> {
  return db.transaction(async () => {
    const row = await db
      .prepare(
        `INSERT INTO announcements (hackathonId, audience, title, body, createdBy)
         VALUES (?, 'lista', ?, ?, ?) RETURNING id`,
      )
      .get<{ id: number }>(hackathonId, content.title, content.body, createdBy);
    const ids = [...new Set(memberIds)];
    const rows = ids.length
      ? await db
          .prepare(
            `SELECT id AS memberId, email, phone, whatsappOptIn FROM members
             WHERE id = ANY(?::int[]) ORDER BY id`,
          )
          .all<RecipientRow>(`{${ids.join(",")}}`)
      : [];
    const insert = db.prepare(
      `INSERT OR IGNORE INTO deliveries (announcementId, memberId, channel) VALUES (?, ?, ?)`,
    );
    let queued = 0;
    for (const r of rows) {
      for (const ch of channelsFor({ ...r, whatsappOptIn: r.whatsappOptIn === 1 })) {
        queued += (await insert.run(row!.id, r.memberId, ch)).changes;
      }
    }
    return { id: row!.id, queued };
  })();
}

// ---------- worker ----------

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

type ClaimedRow = {
  id: number;
  announcementId: number;
  memberId: number;
  channel: Channel;
  attempts: number;
  hackathonId: string;
  hackathonName: string;
  title: string;
  body: string;
  email: string;
  phone: string | null;
  whatsappOptIn: number;
  emailBouncedAt: string | null;
};

export type ProcessResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Trava até `limit` entregas pendentes (queued, ou failed com backoff
 * vencido) e envia uma por uma. FOR UPDATE SKIP LOCKED + claimedAt deixam
 * after() e cron rodarem juntos sem pegar a mesma linha.
 */
export async function processDeliveries(
  limit = 50,
  opts: { now?: Date; env?: DriverEnv } = {},
): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const nowText = sqlTime(now);
  const claimed = await db
    .prepare(
      `WITH claimed AS (
         UPDATE deliveries SET claimedAt = @now
         WHERE id IN (
           SELECT id FROM deliveries
           WHERE (status = 'queued'
                  OR (status = 'failed' AND nextAttemptAt IS NOT NULL AND nextAttemptAt <= @now))
             AND (claimedAt IS NULL OR claimedAt < @stale)
           ORDER BY id
           LIMIT @limit
           FOR UPDATE SKIP LOCKED)
         RETURNING id, announcementId, memberId, channel, attempts)
       SELECT c.*, a.hackathonId, h.name AS hackathonName, a.title, a.body,
              m.email, m.phone, m.whatsappOptIn, m.emailBouncedAt
       FROM claimed c
       JOIN announcements a ON a.id = c.announcementId
       JOIN hackathons h ON h.id = a.hackathonId
       JOIN members m ON m.id = c.memberId
       ORDER BY c.id`,
    )
    .all<ClaimedRow>({ now: nowText, stale: sqlTime(addMin(now, -STALE_CLAIM_MIN)), limit });

  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  if (claimed.length === 0) return result;
  const email = emailDriver(env);
  const whatsapp = whatsappDriver(env);
  const finish = db.prepare(
    `UPDATE deliveries SET status = @status, error = @error, attempts = @attempts,
       nextAttemptAt = @next, sentAt = @sentAt, claimedAt = NULL
     WHERE id = @id`,
  );

  for (const d of claimed) {
    const content = {
      hackathonId: d.hackathonId,
      hackathonName: d.hackathonName,
      title: d.title,
      body: d.body,
    };
    let out: SendOutcome;
    try {
      out = await deliver(d, content, { email, whatsapp });
    } catch (e) {
      out = { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
    const attempts = d.attempts + 1;
    const retry =
      out.status === "failed" && !out.permanent && attempts < MAX_ATTEMPTS
        ? sqlTime(addMin(now, BACKOFF_MIN[attempts - 1] ?? BACKOFF_MIN.at(-1)!))
        : null;
    await finish.run({
      id: d.id,
      status: out.status,
      error: out.status === "failed" ? out.error : out.status === "skipped" ? out.reason : null,
      attempts,
      next: retry,
      sentAt: out.status === "sent" ? nowText : null,
    });
    result.processed++;
    result[out.status]++;
  }
  return result;
}

async function deliver(
  d: ClaimedRow,
  content: Parameters<typeof renderAnnouncementEmail>[0],
  drivers: { email: ReturnType<typeof emailDriver>; whatsapp: ReturnType<typeof whatsappDriver> },
): Promise<SendOutcome> {
  if (d.channel === "inapp") {
    await notify(d.memberId, {
      type: "announcement",
      text: `Aviso em ${d.hackathonName}: ${d.title}`,
      href: `/h/${d.hackathonId}#avisos`,
    });
    return { status: "sent" };
  }
  if (d.channel === "email") {
    if (d.emailBouncedAt) return { status: "skipped", reason: `e-mail com bounce desde ${d.emailBouncedAt}` };
    if (!d.email) return { status: "skipped", reason: "membro sem e-mail" };
    const msg = renderAnnouncementEmail(content);
    return drivers.email.send({
      to: d.email,
      ...msg,
      idempotencyKey: `announcement-${d.announcementId}-member-${d.memberId}-email`,
      unsubscribeUrl: announcementUrls(d.hackathonId).preferences,
    });
  }
  // whatsapp: re-checa no envio — opt-out entre o fan-out e o worker vale
  if (d.whatsappOptIn !== 1) return { status: "skipped", reason: "sem opt-in de WhatsApp" };
  const number = normalizeBrPhone(d.phone ?? "");
  if (!number) return { status: "skipped", reason: "telefone ausente ou inválido" };
  return drivers.whatsapp.send({ number, text: renderAnnouncementWhatsapp(content) });
}

// ---------- leitura ----------

type Counts = Record<DeliveryStatus, number>;
const zero = (): Counts => ({ queued: 0, sent: 0, failed: 0, skipped: 0 });

export type AdminAnnouncement = {
  id: number;
  audience: StoredAudience;
  teamName: string | null;
  title: string;
  body: string;
  createdAt: string;
  authorUsername: string | null;
  stats: Record<Channel, Counts>;
  failures: { username: string; channel: Channel; error: string | null; attempts: number; retrying: boolean }[];
};

export async function listAnnouncementsForAdmin(hackathonId: string): Promise<AdminAnnouncement[]> {
  const [rows, counts, failures] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.audience, a.title, a.body, a.createdAt, t.name AS teamName, m.username AS authorUsername
         FROM announcements a
         LEFT JOIN teams t ON t.id = a.teamId
         LEFT JOIN members m ON m.id = a.createdBy
         WHERE a.hackathonId = ? ORDER BY a.id DESC LIMIT 100`,
      )
      .all<Omit<AdminAnnouncement, "stats" | "failures">>(hackathonId),
    db
      .prepare(
        `SELECT d.announcementId, d.channel, d.status, COUNT(*) AS n
         FROM deliveries d JOIN announcements a ON a.id = d.announcementId
         WHERE a.hackathonId = ?
         GROUP BY d.announcementId, d.channel, d.status`,
      )
      .all<{ announcementId: number; channel: Channel; status: DeliveryStatus; n: number }>(hackathonId),
    db
      .prepare(
        `SELECT d.announcementId, m.username, d.channel, d.error, d.attempts,
                (d.nextAttemptAt IS NOT NULL) AS retrying
         FROM deliveries d
         JOIN announcements a ON a.id = d.announcementId
         JOIN members m ON m.id = d.memberId
         WHERE a.hackathonId = ? AND d.status = 'failed'
         ORDER BY d.id LIMIT 500`,
      )
      .all<AdminAnnouncement["failures"][number] & { announcementId: number }>(hackathonId),
  ]);
  return rows.map((a) => {
    const stats = { inapp: zero(), email: zero(), whatsapp: zero() };
    for (const c of counts) if (c.announcementId === a.id) stats[c.channel][c.status] = c.n;
    return {
      ...a,
      stats,
      failures: failures
        .filter((f) => f.announcementId === a.id)
        .map((f) => ({
          username: f.username,
          channel: f.channel,
          error: f.error,
          attempts: f.attempts,
          retrying: Boolean(f.retrying),
        })),
    };
  });
}

export type MemberAnnouncement = {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};

/**
 * Avisos que o membro vê na edição: os que foram entregues pra ele, mais o
 * histórico de "todos"/"aprovados" que bate com a inscrição atual (quem
 * entra depois lê o que já foi dito). Papéis da edição veem tudo.
 */
export async function listAnnouncementsForMember(
  hackathonId: string,
  memberId: number,
  opts: { all?: boolean } = {},
): Promise<MemberAnnouncement[]> {
  const reg = await db
    .prepare("SELECT status FROM registrations WHERE hackathonId = ? AND memberId = ?")
    .get<{ status: string }>(hackathonId, memberId);
  const rows = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.createdAt,
              EXISTS (SELECT 1 FROM announcement_reads ar
                      WHERE ar.announcementId = a.id AND ar.memberId = @m) AS isRead
       FROM announcements a
       WHERE a.hackathonId = @h AND (
         @all::int = 1
         OR EXISTS (SELECT 1 FROM deliveries d
                    WHERE d.announcementId = a.id AND d.memberId = @m AND d.channel = 'inapp')
         OR (a.audience = 'todos' AND @status::text IN ('approved', 'pending'))
         OR (a.audience = 'aprovados' AND @status::text = 'approved'))
       ORDER BY a.id DESC LIMIT 50`,
    )
    .all<Omit<MemberAnnouncement, "read"> & { isRead: boolean }>({
      h: hackathonId,
      m: memberId,
      status: reg?.status ?? null,
      all: opts.all ? 1 : 0,
    });
  return rows.map(({ isRead, ...a }) => ({ ...a, read: Boolean(isRead) }));
}

export async function markAnnouncementsRead(memberId: number, ids: number[]): Promise<void> {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO announcement_reads (announcementId, memberId) VALUES (?, ?)",
  );
  for (const id of ids) await ins.run(id, memberId);
}

export async function listEditionTeams(hackathonId: string) {
  return db
    .prepare("SELECT id, name FROM teams WHERE hackathonId = ? ORDER BY name")
    .all<{ id: number; name: string }>(hackathonId);
}
