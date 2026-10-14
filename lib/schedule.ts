import { createHmac, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import { publishToMembers } from "@/lib/announcements";
import { ticketSecret } from "@/lib/checkins";
import type { Hackathon } from "@/lib/hackathons";
import { getEditionRoles, type EditionRole } from "@/lib/roles";
import { absoluteUrl } from "@/lib/seo";
import type { IcsEvent } from "@/lib/ics";

// Programação da edição (roadmap 037 Onda 1 #4, research 035 #5).
// Datas no banco: TEXT "YYYY-MM-DD HH:MM:SS" UTC. Entrada e exibição em
// America/Sao_Paulo. Item nasce rascunho; publicado aparece na página.
// Mudar horário/sala de item publicado avisa os afetados (público do item)
// uma vez por alteração — (itemId, revision) em schedule_change_notices.

export const TZ = "America/Sao_Paulo";

export const SCHEDULE_AUDIENCES = ["todos", "participantes", "mentores", "jurados", "staff"] as const;
export type ScheduleAudience = (typeof SCHEDULE_AUDIENCES)[number];
export const SCHEDULE_KINDS = [
  "abertura",
  "palestra",
  "oficina",
  "refeicao",
  "mentoria",
  "pitch",
  "encerramento",
  "outro",
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const AUDIENCE_LABEL: Record<ScheduleAudience, string> = {
  todos: "aberto a todos",
  participantes: "participantes",
  mentores: "mentores",
  jurados: "jurados",
  staff: "staff",
};
export const KIND_LABEL: Record<ScheduleKind, string> = {
  abertura: "abertura",
  palestra: "palestra",
  oficina: "oficina",
  refeicao: "refeição",
  mentoria: "mentoria",
  pitch: "pitch",
  encerramento: "encerramento",
  outro: "outro",
};

export type ScheduleItem = {
  id: number;
  hackathonId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  room: string;
  audience: ScheduleAudience;
  kind: ScheduleKind;
  publishedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

// ---------- fuso ----------

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function spParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** minutos que SP está à frente do UTC naquele instante (−180 hoje) */
function spOffsetMin(d: Date): number {
  const p = spParts(d);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60_000;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const toDbText = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
export const fromDbText = (t: string) => new Date(`${t.replace(" ", "T")}Z`);

/** "2026-11-14" + "09:30" em São Paulo → "2026-11-14 12:30:00" UTC; null se inválido */
export function spLocalToUtc(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - spOffsetMin(new Date(guess)) * 60_000;
  utc = guess - spOffsetMin(new Date(utc)) * 60_000; // borda de mudança de offset
  const back = spParts(new Date(utc));
  if (back.y !== y || back.mo !== mo || back.d !== d) return null; // 31/02 etc.
  return toDbText(new Date(utc));
}

/** UTC do banco → { date: "YYYY-MM-DD", time: "HH:MM" } em São Paulo */
export function utcToSp(dbText: string): { date: string; time: string } {
  const p = spParts(fromDbText(dbText));
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

const dayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" });
const shortDayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });

/** "sábado, 14 de novembro" */
export const dayLabel = (dbText: string) => dayFmt.format(fromDbText(dbText));
/** "sáb., 14/11" → "sáb 14/11" */
export const shortDayLabel = (dbText: string) => shortDayFmt.format(fromDbText(dbText)).replace(/\.,?/g, "");
export const timeLabel = (dbText: string) => utcToSp(dbText).time;

// ---------- validação ----------

export type ScheduleInput = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  room: string;
  audience: ScheduleAudience;
  kind: ScheduleKind;
};

export const isScheduleAudience = (v: unknown): v is ScheduleAudience =>
  typeof v === "string" && (SCHEDULE_AUDIENCES as readonly string[]).includes(v);
export const isScheduleKind = (v: unknown): v is ScheduleKind =>
  typeof v === "string" && (SCHEDULE_KINDS as readonly string[]).includes(v);

const DAY_MS = 86_400_000;

/** janela aceita: do início da edição − 1 dia ao fim (ou início) + 1 dia */
export function editionWindow(h: Pick<Hackathon, "startsAt" | "endsAt">): { from: Date; to: Date } | null {
  const s = new Date(h.startsAt).getTime();
  const e = new Date(h.endsAt ?? h.startsAt).getTime();
  if (Number.isNaN(s)) return null;
  return { from: new Date(s - DAY_MS), to: new Date((Number.isNaN(e) ? s : e) + DAY_MS) };
}

/**
 * Corpo do formulário → item normalizado. Horário vem em hora de São Paulo
 * (date + start, endDate opcional + end). Lança Error com a mensagem pra UI.
 */
export function validateScheduleInput(raw: unknown, h: Pick<Hackathon, "startsAt" | "endsAt">): ScheduleInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const title = str("title");
  if (!title || title.length > 140) throw new Error("título obrigatório (até 140 caracteres)");
  const description = str("description");
  if (description.length > 2000) throw new Error("descrição até 2000 caracteres");
  const room = str("room");
  if (room.length > 80) throw new Error("sala até 80 caracteres");
  const audience = b.audience ?? "todos";
  if (!isScheduleAudience(audience)) throw new Error("público inválido");
  const kind = b.kind ?? "outro";
  if (!isScheduleKind(kind)) throw new Error("tipo inválido");
  const startsAt = spLocalToUtc(str("date"), str("start"));
  const endsAt = spLocalToUtc(str("endDate") || str("date"), str("end"));
  if (!startsAt) throw new Error("data/hora de início inválida");
  if (!endsAt) throw new Error("data/hora de fim inválida");
  if (endsAt <= startsAt) throw new Error("o fim tem que ser depois do início");
  const win = editionWindow(h);
  if (win && (fromDbText(startsAt) < win.from || fromDbText(endsAt) > win.to)) {
    throw new Error("fora do período da edição (folga de 1 dia antes e depois)");
  }
  return { title, description, startsAt, endsAt, room, audience, kind };
}

// ---------- quem vê ----------

export type ScheduleViewer = {
  /** admin global ou organizador: vê tudo, inclusive rascunho */
  manager: boolean;
  roles: EditionRole[];
  /** inscrição aprovada na edição */
  participant: boolean;
};

export const ANON_VIEWER: ScheduleViewer = { manager: false, roles: [], participant: false };

export function canSeeAudience(a: ScheduleAudience, v: ScheduleViewer): boolean {
  if (a === "todos" || v.manager) return true;
  if (a === "participantes") return v.participant || v.roles.length > 0;
  if (a === "mentores") return v.roles.includes("mentor");
  if (a === "jurados") return v.roles.includes("jurado");
  return v.roles.includes("staff");
}

/** viewer "conta" pra ter feed pessoal? (inscrição aprovada/pendente ou papel) */
export function hasScheduleAccess(v: ScheduleViewer, status: string | null): boolean {
  return v.manager || v.roles.length > 0 || status === "approved" || status === "pending";
}

export async function scheduleViewerFor(
  member: { id: number; role: string } | null,
  hackathonId: string,
): Promise<ScheduleViewer & { status: string | null }> {
  if (!member) return { ...ANON_VIEWER, status: null };
  const [roles, reg] = await Promise.all([
    getEditionRoles(hackathonId, member.id),
    db
      .prepare("SELECT status FROM registrations WHERE hackathonId = ? AND memberId = ?")
      .get<{ status: string }>(hackathonId, member.id),
  ]);
  return {
    manager: member.role === "admin" || roles.includes("organizador"),
    roles,
    participant: reg?.status === "approved",
    status: reg?.status ?? null,
  };
}

// ---------- leitura ----------

const COLS = `id, hackathonId, title, description, startsAt, endsAt, room, audience, kind,
  publishedAt, revision, createdAt, updatedAt`;

export async function listScheduleItems(
  hackathonId: string,
  opts: { includeDrafts?: boolean } = {},
): Promise<ScheduleItem[]> {
  return db
    .prepare(
      `SELECT ${COLS} FROM schedule_items
       WHERE hackathonId = ? AND (?::int = 1 OR publishedAt IS NOT NULL)
       ORDER BY startsAt, endsAt, id`,
    )
    .all<ScheduleItem>(hackathonId, opts.includeDrafts ? 1 : 0);
}

/** publicados que esse viewer pode ver */
export async function listVisibleScheduleItems(hackathonId: string, v: ScheduleViewer): Promise<ScheduleItem[]> {
  return (await listScheduleItems(hackathonId)).filter((i) => canSeeAudience(i.audience, v));
}

export async function getScheduleItem(hackathonId: string, itemId: number): Promise<ScheduleItem | null> {
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  return (
    (await db
      .prepare(`SELECT ${COLS} FROM schedule_items WHERE id = ? AND hackathonId = ?`)
      .get<ScheduleItem>(itemId, hackathonId)) ?? null
  );
}

export type DayGroup = { date: string; label: string; items: ScheduleItem[] };

/** agrupa por dia (de início) em São Paulo, na ordem */
export function groupByDay(items: ScheduleItem[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const i of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id)) {
    const date = utcToSp(i.startsAt).date;
    let g = out.at(-1);
    if (!g || g.date !== date) {
      g = { date, label: dayLabel(i.startsAt), items: [] };
      out.push(g);
    }
    g.items.push(i);
  }
  return out;
}

/** o que está rolando e os próximos (até `limit`) */
export function nowAndNext(items: ScheduleItem[], now: Date, limit = 2): { now: ScheduleItem[]; next: ScheduleItem[] } {
  const t = toDbText(now);
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
  return {
    now: sorted.filter((i) => i.startsAt <= t && t < i.endsAt),
    next: sorted.filter((i) => i.startsAt > t).slice(0, limit),
  };
}

// ---------- escrita ----------

export async function createScheduleItem(
  hackathonId: string,
  input: ScheduleInput,
  createdBy: number | null,
): Promise<ScheduleItem> {
  const row = await db
    .prepare(
      `INSERT INTO schedule_items (hackathonId, title, description, startsAt, endsAt, room, audience, kind, createdBy)
       VALUES (@h, @title, @description, @startsAt, @endsAt, @room, @audience, @kind, @by)
       RETURNING ${COLS}`,
    )
    .get<ScheduleItem>({ h: hackathonId, ...input, by: createdBy });
  return row!;
}

/** cópia como rascunho (pra repetir oficina/refeição em outro dia/sala) */
export async function duplicateScheduleItem(
  hackathonId: string,
  itemId: number,
  createdBy: number | null,
): Promise<ScheduleItem | null> {
  const src = await getScheduleItem(hackathonId, itemId);
  if (!src) return null;
  return createScheduleItem(
    hackathonId,
    {
      title: `${src.title} (cópia)`.slice(0, 140),
      description: src.description,
      startsAt: src.startsAt,
      endsAt: src.endsAt,
      room: src.room,
      audience: src.audience,
      kind: src.kind,
    },
    createdBy,
  );
}

export async function deleteScheduleItem(hackathonId: string, itemId: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM schedule_items WHERE id = ? AND hackathonId = ?").run(itemId, hackathonId);
  return r.changes > 0;
}

/** publica os rascunhos (todos, ou só `ids`); devolve quantos */
export async function publishSchedule(hackathonId: string, ids?: number[]): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE schedule_items SET publishedAt = datetime('now'), updatedAt = datetime('now')
       WHERE hackathonId = ? AND publishedAt IS NULL
         AND (?::text IS NULL OR id = ANY(?::int[]))`,
    )
    .run(hackathonId, ids ? "1" : null, `{${(ids ?? []).filter(Number.isInteger).join(",")}}`);
  return r.changes;
}

export type ScheduleUpdate = {
  item: ScheduleItem;
  /** aviso gerado por esta alteração (null = não mudou horário/sala, rascunho ou já avisado) */
  announcementId: number | null;
};

/**
 * Edita o item. Se horário ou sala mudaram, revision sobe; se o item já
 * estava publicado, avisa os afetados (uma vez por revision). A linha fica
 * travada (FOR UPDATE) até o fim, então duas edições simultâneas não leem
 * o mesmo "antes".
 */
export async function updateScheduleItem(
  hackathonId: string,
  itemId: number,
  input: ScheduleInput,
  actorId: number | null,
): Promise<ScheduleUpdate | null> {
  return db.transaction(async () => {
    const before = await db
      .prepare(`SELECT ${COLS} FROM schedule_items WHERE id = ? AND hackathonId = ? FOR UPDATE`)
      .get<ScheduleItem>(itemId, hackathonId);
    if (!before) return null;
    const moved =
      before.startsAt !== input.startsAt || before.endsAt !== input.endsAt || before.room !== input.room;
    const item = (await db
      .prepare(
        `UPDATE schedule_items SET title = @title, description = @description, startsAt = @startsAt,
           endsAt = @endsAt, room = @room, audience = @audience, kind = @kind,
           revision = revision + @bump, updatedAt = datetime('now')
         WHERE id = @id RETURNING ${COLS}`,
      )
      .get<ScheduleItem>({ ...input, bump: moved ? 1 : 0, id: itemId }))!;
    const announcementId =
      moved && before.publishedAt ? await notifyScheduleChange(item, before, actorId) : null;
    return { item, announcementId };
  })();
}

type Slot = Pick<ScheduleItem, "startsAt" | "endsAt" | "room">;

/** destinatários do aviso de mudança, pelo público do item */
export async function scheduleRecipients(hackathonId: string, audience: ScheduleAudience): Promise<number[]> {
  const role = { mentores: "mentor", jurados: "jurado", staff: "staff" }[audience as string];
  let rows: { id: number }[];
  if (role) {
    rows = await db
      .prepare("SELECT memberId AS id FROM edition_roles WHERE hackathonId = ? AND role = ?")
      .all<{ id: number }>(hackathonId, role);
  } else if (audience === "participantes") {
    rows = await db
      .prepare("SELECT memberId AS id FROM registrations WHERE hackathonId = ? AND status = 'approved'")
      .all<{ id: number }>(hackathonId);
  } else {
    rows = await db
      .prepare(
        `SELECT memberId AS id FROM registrations WHERE hackathonId = ? AND status IN ('approved', 'pending')
         UNION SELECT memberId AS id FROM edition_roles WHERE hackathonId = ?`,
      )
      .all<{ id: number }>(hackathonId, hackathonId);
  }
  return [...new Set(rows.map((r) => r.id))].sort((a, b) => a - b);
}

/** "mudou: Almoço agora às 13:00 na sala Refeitório" (+ dia se mudou de dia) */
export function changeNoticeText(
  item: Pick<ScheduleItem, "title" | "hackathonId"> & Slot,
  before: Slot,
): { title: string; body: string } {
  const dayChanged = utcToSp(before.startsAt).date !== utcToSp(item.startsAt).date;
  const when = `${timeLabel(item.startsAt)}${dayChanged ? ` (${shortDayLabel(item.startsAt)})` : ""}`;
  const where = item.room ? ` na sala ${item.room}` : "";
  const fixed = `mudou:  agora às ${when}${where}`.length;
  const name = item.title.length + fixed > 140 ? `${item.title.slice(0, Math.max(10, 139 - fixed))}…` : item.title;
  const slot = (s: Slot) =>
    `${shortDayLabel(s.startsAt)}, ${timeLabel(s.startsAt)}–${timeLabel(s.endsAt)}${s.room ? `, sala ${s.room}` : ""}`;
  return {
    title: `mudou: ${name} agora às ${when}${where}`.slice(0, 140),
    body: [
      `${item.title}: ${slot(item)}.`,
      `Antes era ${slot(before)}.`,
      `Programação completa: ${absoluteUrl(`/h/${item.hackathonId}/programacao`)}`,
    ].join("\n"),
  };
}

/**
 * Aviso automático de uma alteração (item.revision). Idempotente: a PK
 * (itemId, revision) em schedule_change_notices deixa passar só a primeira
 * chamada; as outras devolvem null sem publicar nada.
 */
export async function notifyScheduleChange(
  item: ScheduleItem,
  before: Slot,
  actorId: number | null,
): Promise<number | null> {
  return db.transaction(async () => {
    const claimed = await db
      .prepare("INSERT OR IGNORE INTO schedule_change_notices (itemId, revision) VALUES (?, ?)")
      .run(item.id, item.revision);
    if (claimed.changes === 0) return null;
    const recipients = await scheduleRecipients(item.hackathonId, item.audience);
    if (recipients.length === 0) return null;
    const { id } = await publishToMembers(item.hackathonId, actorId, changeNoticeText(item, before), recipients);
    await db
      .prepare("UPDATE schedule_change_notices SET announcementId = ? WHERE itemId = ? AND revision = ?")
      .run(id, item.id, item.revision);
    return id;
  })();
}

// ---------- edição mudou de data (frente N #7) ----------
// Quando o organizador muda o startsAt da edição, a programação inteira
// fica no dia errado. Deslocar é opcional e explícito (o organizador marca
// na hora de salvar): todos os itens andam o mesmo delta, cada um sobe a
// revision (o .ics atualiza pelo UID + SEQUENCE) e os inscritos recebem UM
// aviso "a agenda mudou" — não um por item.

const MIN_MS = 60_000;

/** "+2 dias", "−3 h", "+1 dia e 2 h", "+30 min" */
export function formatShift(deltaMs: number): string {
  const sign = deltaMs < 0 ? "−" : "+";
  let mins = Math.round(Math.abs(deltaMs) / MIN_MS);
  const days = Math.floor(mins / 1440);
  mins -= days * 1440;
  const hours = Math.floor(mins / 60);
  mins -= hours * 60;
  const parts = [
    days ? `${days} ${days === 1 ? "dia" : "dias"}` : null,
    hours ? `${hours} h` : null,
    mins ? `${mins} min` : null,
  ].filter(Boolean);
  if (parts.length === 0) return "+0 min";
  return `${sign}${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0]}`;
}

export async function countScheduleItems(hackathonId: string): Promise<{ total: number; published: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE publishedAt IS NOT NULL) AS published
       FROM schedule_items WHERE hackathonId = ?`,
    )
    .get<{ total: number; published: number }>(hackathonId);
  return { total: Number(row?.total ?? 0), published: Number(row?.published ?? 0) };
}

export function shiftNoticeText(
  hackathonId: string,
  deltaMs: number,
  firstItemStart: string | null,
): { title: string; body: string } {
  const first = firstItemStart ? ` — primeiro item ${shortDayLabel(firstItemStart)} às ${timeLabel(firstItemStart)}` : "";
  return {
    title: `a agenda mudou: programação deslocada ${formatShift(deltaMs)}${first}`.slice(0, 140),
    body: [
      `A data da edição mudou e a programação inteira foi deslocada (${formatShift(deltaMs)}).`,
      `Se você assinou o calendário (.ics), ele se atualiza sozinho.`,
      `Programação completa: ${absoluteUrl(`/h/${hackathonId}/programacao`)}`,
    ].join("\n"),
  };
}

/**
 * Diferença de relógio entre o início antigo e o novo, como o organizador
 * vê no formulário (datetime-local, sem fuso): compara "YYYY-MM-DDTHH:MM"
 * dos dois lados, ignorando sufixo de fuso — o formulário mostra os 16
 * primeiros caracteres e devolve sem fuso, então só a parede do relógio é
 * comparável. Só data ("2027-01-01") vale 09:00. null se não der pra ler.
 */
export function wallClockDelta(oldStart: string, newStart: string): number | null {
  const wall = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v.trim());
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] === undefined ? 9 : +m[4], m[5] === undefined ? 0 : +m[5]);
  };
  const a = wall(oldStart);
  const b = wall(newStart);
  return a === null || b === null ? null : b - a;
}

/**
 * Desloca todos os itens da programação em deltaMs. Itens publicados ganham
 * revision nova (claim em schedule_change_notices — o aviso por item não
 * dispara de novo pra mesma alteração) e quem tem relação com a edição
 * recebe um aviso único. delta 0 é no-op.
 */
export async function shiftSchedule(
  hackathonId: string,
  deltaMs: number,
  actorId: number | null,
): Promise<{ moved: number; announcementId: number | null }> {
  if (!Number.isFinite(deltaMs) || Math.round(deltaMs / 1000) === 0) return { moved: 0, announcementId: null };
  return db.transaction(async () => {
    const items = await db
      .prepare(`SELECT ${COLS} FROM schedule_items WHERE hackathonId = ? ORDER BY id FOR UPDATE`)
      .all<ScheduleItem>(hackathonId);
    const published: ScheduleItem[] = [];
    for (const it of items) {
      const moved = (await db
        .prepare(
          `UPDATE schedule_items SET startsAt = ?, endsAt = ?, revision = revision + 1, updatedAt = datetime('now')
           WHERE id = ? RETURNING ${COLS}`,
        )
        .get<ScheduleItem>(
          toDbText(new Date(fromDbText(it.startsAt).getTime() + deltaMs)),
          toDbText(new Date(fromDbText(it.endsAt).getTime() + deltaMs)),
          it.id,
        ))!;
      if (moved.publishedAt) published.push(moved);
    }
    let announcementId: number | null = null;
    if (published.length > 0) {
      const recipients = await scheduleRecipients(hackathonId, "todos");
      if (recipients.length > 0) {
        const first = published.reduce((m, it) => (it.startsAt < m ? it.startsAt : m), published[0].startsAt);
        announcementId = (await publishToMembers(hackathonId, actorId, shiftNoticeText(hackathonId, deltaMs, first), recipients)).id;
      }
      for (const it of published) {
        await db
          .prepare("INSERT OR IGNORE INTO schedule_change_notices (itemId, revision, announcementId) VALUES (?, ?, ?)")
          .run(it.id, it.revision, announcementId);
      }
    }
    return { moved: items.length, announcementId };
  })();
}

// ---------- calendário ----------

export function itemUid(item: Pick<ScheduleItem, "id" | "hackathonId">): string {
  return `programacao-${item.id}-${item.hackathonId}@${new URL(absoluteUrl("/")).host}`;
}

export function toIcsEvent(item: ScheduleItem, h: Pick<Hackathon, "name" | "location">): IcsEvent {
  const location = [item.room, h.location].filter(Boolean).join(" · ");
  const url = absoluteUrl(`/h/${item.hackathonId}/programacao#item-${item.id}`);
  return {
    uid: itemUid(item),
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    stamp: item.updatedAt,
    sequence: item.revision,
    summary: `${item.title} · ${h.name}`,
    description: [item.description, url].filter(Boolean).join("\n\n"),
    location: location || undefined,
    url,
    categories: [KIND_LABEL[item.kind]],
  };
}

// feed pessoal: token = "HC1." + base64url(JSON [memberId, hackathonId, version])
// + "." + HMAC-SHA256 (segredo do ingresso com rótulo próprio). version vem
// de calendar_feeds; revogar sobe a versão e mata os links antigos.
const CAL_PREFIX = "HC1.";

function calMac(payload: string): string {
  return createHmac("sha256", ticketSecret()).update(`calendar-feed:${payload}`).digest("base64url");
}

export function calendarToken(memberId: number, hackathonId: string, version: number): string {
  const payload = Buffer.from(JSON.stringify([memberId, hackathonId, version])).toString("base64url");
  return `${CAL_PREFIX}${payload}.${calMac(payload)}`;
}

/** confere assinatura e formato; NÃO olha o banco (revogação é em resolveCalendarToken) */
export function parseCalendarToken(token: string): { memberId: number; hackathonId: string; version: number } | null {
  if (typeof token !== "string" || !token.startsWith(CAL_PREFIX) || token.length > 400) return null;
  const [payload, mac, extra] = token.slice(CAL_PREFIX.length).split(".");
  // formato antes do HMAC: lixo nem chega a tocar no segredo
  if (!payload || !mac || extra !== undefined) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return null;
  const expected = Buffer.from(calMac(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const [memberId, hackathonId, version] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isInteger(memberId) || typeof hackathonId !== "string" || !Number.isInteger(version)) return null;
    return { memberId, hackathonId, version };
  } catch {
    return null;
  }
}

export async function resolveCalendarToken(token: string): Promise<{ memberId: number; hackathonId: string } | null> {
  const t = parseCalendarToken(token);
  if (!t) return null;
  const row = await db
    .prepare("SELECT version FROM calendar_feeds WHERE memberId = ? AND hackathonId = ?")
    .get<{ version: number }>(t.memberId, t.hackathonId);
  return row && row.version === t.version ? { memberId: t.memberId, hackathonId: t.hackathonId } : null;
}

/** token vigente do membro na edição (cria o feed na primeira vez) */
export async function calendarTokenFor(memberId: number, hackathonId: string): Promise<string> {
  await db
    .prepare("INSERT OR IGNORE INTO calendar_feeds (memberId, hackathonId) VALUES (?, ?)")
    .run(memberId, hackathonId);
  const row = await db
    .prepare("SELECT version FROM calendar_feeds WHERE memberId = ? AND hackathonId = ?")
    .get<{ version: number }>(memberId, hackathonId);
  return calendarToken(memberId, hackathonId, row!.version);
}

/** revoga o link atual e devolve um novo */
export async function rotateCalendarToken(memberId: number, hackathonId: string): Promise<string> {
  const row = await db
    .prepare(
      `INSERT INTO calendar_feeds (memberId, hackathonId, version, rotatedAt) VALUES (?, ?, 2, datetime('now'))
       ON CONFLICT (memberId, hackathonId) DO UPDATE
         SET version = calendar_feeds.version + 1, rotatedAt = datetime('now')
       RETURNING version`,
    )
    .get<{ version: number }>(memberId, hackathonId);
  return calendarToken(memberId, hackathonId, row!.version);
}

export const personalFeedPath = (token: string) => `/api/me/calendar/${token}.ics`;

// ---------- painel ----------

/** item no formato do formulário do painel (hora de São Paulo) */
export type EditorItem = {
  id: number;
  title: string;
  description: string;
  room: string;
  audience: ScheduleAudience;
  kind: ScheduleKind;
  published: boolean;
  date: string;
  start: string;
  endDate: string;
  end: string;
};

export function toEditorItem(i: ScheduleItem): EditorItem {
  const s = utcToSp(i.startsAt);
  const e = utcToSp(i.endsAt);
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    room: i.room,
    audience: i.audience,
    kind: i.kind,
    published: i.publishedAt !== null,
    date: s.date,
    start: s.time,
    endDate: e.date,
    end: e.time,
  };
}
