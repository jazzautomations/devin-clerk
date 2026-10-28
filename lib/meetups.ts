import db from "@/lib/db";
import { canManageCommunity, cleanUrl, type Community } from "@/lib/communities";
import { EventTimeError, parseEventTime } from "@/lib/eventTime";
import { communityAudience } from "@/lib/follows";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import type { Member } from "@/lib/members";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";
import type { RateLimitOpts } from "@/lib/ratelimit";
import { absoluteUrl } from "@/lib/seo";
import { currentMember } from "@/lib/session";

// Agenda da comunidade (migration 051): meetup, live, workshop e demo day
// entre uma edição e outra. Dono e organizador criam e publicam; publicar
// avisa membros e quem segue. RSVP "vou"/"talvez" com lotação, .ics, live
// embutida (só YouTube e Twitch) e pedido de palco no demo day.
//
// Comunidade escondida pela moderação (ou apagada) leva a agenda junto: some
// das listas, do feed e da página pra quem não é admin.

// ---------- tipos e rótulos ----------

export const MEETUP_KINDS = ["meetup", "live", "workshop", "demo_day"] as const;
export type MeetupKind = (typeof MEETUP_KINDS)[number];

export const MEETUP_KIND_LABEL: Record<MeetupKind, string> = {
  meetup: "meetup",
  live: "live",
  workshop: "workshop",
  demo_day: "demo day",
};

export const MEETUP_LIMITS = {
  title: 100,
  description: 3000,
  location: 160,
  url: 300,
  pitch: 280,
  hosts: 5,
  capacity: 100_000,
  /** duração máxima entre início e fim */
  maxHours: 72,
} as const;

/** sem fim informado, o evento dura isso (janela da live, .ics, "já rolou") */
export const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
/** a live aparece 15 min antes do início */
export const EMBED_LEAD_MS = 15 * 60 * 1000;

// Limites que não estão na tabela de lib/ratelimit.ts (lá fica só a chave
// 'meetups', criar e editar). Publicar e cancelar são ações raras de quem
// organiza; RSVP e palco são cliques de membro.
export const MEETUP_ACTION_LIMITS: Record<"rsvp" | "stage" | "manage", RateLimitOpts> = {
  rsvp: { limit: 60, windowMs: 60 * 60 * 1000 },
  stage: { limit: 10, windowMs: 60 * 60 * 1000 },
  manage: { limit: 60, windowMs: 60 * 60 * 1000 },
};

export type RsvpStatus = "vou" | "talvez";
export type StageStatus = "pedido" | "aceito" | "recusado";

export type Meetup = {
  id: number;
  communityId: number;
  communitySlug: string;
  communityName: string;
  communityHidden: boolean;
  kind: MeetupKind;
  title: string;
  description: string | null;
  /** "YYYY-MM-DD HH:MM:SS" UTC */
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  onlineUrl: string | null;
  embedUrl: string | null;
  capacity: number | null;
  createdBy: number | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  sequence: number;
  createdAt: string;
  updatedAt: string | null;
};

type MeetupRow = Omit<Meetup, "communityHidden"> & { communityHidden: number };

export class MeetupError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

// ---------- datas ----------

/** Date → "YYYY-MM-DD HH:MM:SS" (UTC, convenção do schema) */
export function toDbUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const dbDate = (v: string) => parseEventTime(v)!;

/** fim efetivo: o informado ou início + 2h */
export function meetupEnd(m: Pick<Meetup, "startsAt" | "endsAt">): Date {
  if (m.endsAt) return dbDate(m.endsAt);
  return new Date(dbDate(m.startsAt).getTime() + DEFAULT_DURATION_MS);
}

/** a live embutida aparece de 15 min antes do início até o fim */
export function isEmbedWindow(m: Pick<Meetup, "startsAt" | "endsAt">, now = new Date()): boolean {
  const start = dbDate(m.startsAt).getTime();
  return start - EMBED_LEAD_MS <= now.getTime() && now.getTime() <= meetupEnd(m).getTime();
}

export function isMeetupOver(m: Pick<Meetup, "startsAt" | "endsAt">, now = new Date()): boolean {
  return meetupEnd(m).getTime() < now.getTime();
}

const fmtQuando = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/** "qua., 12 de nov., 19:00" (Brasília) */
export function fmtMeetupWhen(v: string): string {
  const d = parseEventTime(v);
  return d ? fmtQuando.format(d) : "";
}

/** "qua., 12 de nov., 19:00 até 21:00" — o fim só com a hora se for no mesmo dia */
export function fmtMeetupRange(m: Pick<Meetup, "startsAt" | "endsAt">): string {
  const start = dbDate(m.startsAt);
  const head = fmtQuando.format(start);
  if (!m.endsAt) return head;
  const end = dbDate(m.endsAt);
  const sameDay = fmtDia.format(start) === fmtDia.format(end);
  return `${head} até ${sameDay ? fmtHora.format(end) : fmtQuando.format(end)}`;
}

// ---------- live embutida ----------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{3,25}$/;
const TWITCH_VIDEO = /^v?(\d{5,15})$/;
// primeiro segmento de twitch.tv que não é canal
const TWITCH_RESERVED = new Set(["directory", "videos", "p", "settings", "downloads", "jobs", "search", "subscriptions", "inventory", "wallet", "drops", "turbo"]);

/**
 * Link de live → URL canônica de embed. Aceita YouTube (watch?v=, youtu.be,
 * /embed/, /live/, /shorts/, youtube-nocookie) e Twitch (canal, /videos/ID,
 * player.twitch.tv). Qualquer outra coisa é null (a rota responde 400).
 * A canônica não leva o parent da Twitch: ele depende do domínio da página
 * e entra em embedSrc().
 */
export function toEmbedUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MEETUP_LIMITS.url || /\s/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = parts.length === 1 ? parts[0] : null;
    else if (parts[0] === "watch" && parts.length === 1) id = u.searchParams.get("v");
    else if (["embed", "live", "shorts"].includes(parts[0]) && parts.length === 2) id = parts[1];
    if (host === "youtube-nocookie.com" && parts[0] !== "embed") id = null;
    return id && YT_ID.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (host === "player.twitch.tv") {
    if (parts.length) return null;
    const channel = u.searchParams.get("channel");
    const video = u.searchParams.get("video");
    if (channel && !video && TWITCH_CHANNEL.test(channel)) return `https://player.twitch.tv/?channel=${channel.toLowerCase()}`;
    const v = video && !channel ? TWITCH_VIDEO.exec(video) : null;
    return v ? `https://player.twitch.tv/?video=v${v[1]}` : null;
  }

  if (host === "twitch.tv") {
    if (parts[0] === "videos" && parts.length === 2) {
      const v = TWITCH_VIDEO.exec(parts[1]);
      return v ? `https://player.twitch.tv/?video=v${v[1]}` : null;
    }
    if (parts.length === 1 && !TWITCH_RESERVED.has(parts[0].toLowerCase()) && TWITCH_CHANNEL.test(parts[0])) {
      return `https://player.twitch.tv/?channel=${parts[0].toLowerCase()}`;
    }
    return null;
  }
  return null;
}

/**
 * src do iframe. Revalida a URL salva (nunca confia no banco) e põe o parent
 * que a Twitch exige: o domínio de quem está mostrando, sem porta.
 */
export function embedSrc(stored: string | null, pageHost: string): string | null {
  if (!stored) return null;
  const canon = toEmbedUrl(stored);
  if (!canon || canon !== stored) return null;
  if (!canon.startsWith("https://player.twitch.tv/")) return canon;
  const parent = pageHost.trim().toLowerCase().replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]+$/.test(parent)) return null;
  return `${canon}&parent=${parent}`;
}

/** sandbox e allow do iframe: o mínimo pra um player tocar */
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation";
export const EMBED_ALLOW = "encrypted-media; fullscreen; picture-in-picture";

// ---------- validação do formulário ----------

export type MeetupInput = {
  kind: MeetupKind;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  onlineUrl: string | null;
  embedUrl: string | null;
  capacity: number | null;
  /** @ sem o arroba, já minúsculo */
  hosts: string[];
};

function wallToUtc(v: string, field: string): string {
  const d = parseEventTime(v);
  if (!d) throw new EventTimeError(`${field}: use o seletor de data (horário de Brasília)`);
  return toDbUtc(d);
}

/**
 * Valida o corpo de criar/editar. Datas chegam como o datetime-local manda
 * (horário de Brasília) e saem em UTC. Na edição, `current` é o que está
 * salvo: horário que não mudou pode estar no passado.
 */
export function parseMeetupInput(
  b: Record<string, unknown>,
  opts: { now?: Date; current?: Pick<Meetup, "startsAt"> } = {},
): { value: MeetupInput } | { error: string } {
  const now = opts.now ?? new Date();
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const kind = str("kind") as MeetupKind;
  if (!MEETUP_KINDS.includes(kind)) return { error: "Escolha o tipo: meetup, live, workshop ou demo day." };
  const title = str("title").replace(/\s+/g, " ");
  if (title.length < 3 || title.length > MEETUP_LIMITS.title) {
    return { error: `Dê um título de 3 a ${MEETUP_LIMITS.title} caracteres.` };
  }
  const description = str("description").replace(/\r\n/g, "\n") || null;
  if (description && description.length > MEETUP_LIMITS.description) {
    return { error: `Descrição: até ${MEETUP_LIMITS.description} caracteres.` };
  }

  let startsAt: string;
  let endsAt: string | null;
  try {
    if (!str("startsAt")) return { error: "Informe quando começa." };
    startsAt = wallToUtc(str("startsAt"), "início");
    endsAt = str("endsAt") ? wallToUtc(str("endsAt"), "fim") : null;
  } catch (e) {
    if (e instanceof EventTimeError) return { error: e.message };
    throw e;
  }
  const start = dbDate(startsAt).getTime();
  const unchanged = opts.current && dbDate(opts.current.startsAt).getTime() === start;
  if (!unchanged && start < now.getTime()) return { error: "O início já passou. Escolha uma data futura." };
  if (endsAt) {
    const end = dbDate(endsAt).getTime();
    if (end <= start) return { error: "O fim vem depois do início." };
    if (end - start > MEETUP_LIMITS.maxHours * 3600_000) return { error: `Duração máxima: ${MEETUP_LIMITS.maxHours} horas.` };
  }

  const location = str("location").replace(/\s+/g, " ") || null;
  if (location && location.length > MEETUP_LIMITS.location) return { error: `Local: até ${MEETUP_LIMITS.location} caracteres.` };
  const online = cleanUrl(b.onlineUrl, { httpsOnly: true });
  if ("error" in online) return { error: "Link da sala inválido: use um link https://." };

  let embedUrl: string | null = null;
  if (str("embedUrl")) {
    embedUrl = toEmbedUrl(str("embedUrl"));
    if (!embedUrl) return { error: "A live embutida aceita só link do YouTube ou da Twitch." };
  }
  if (!location && !online.value && !embedUrl) {
    return { error: "Diga onde vai ser: o local, o link da sala ou a live." };
  }

  let capacity: number | null = null;
  if (b.capacity !== undefined && b.capacity !== null && b.capacity !== "") {
    const n = Number(b.capacity);
    if (!Number.isInteger(n) || n < 1 || n > MEETUP_LIMITS.capacity) return { error: "Vagas: um número inteiro a partir de 1." };
    capacity = n;
  }

  const rawHosts: unknown[] = Array.isArray(b.hosts)
    ? b.hosts
    : typeof b.hosts === "string"
      ? b.hosts.split(/[\s,]+/)
      : [];
  const hosts = [
    ...new Set(
      rawHosts
        .filter((h): h is string => typeof h === "string")
        .map((h) => h.trim().replace(/^@/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (hosts.length > MEETUP_LIMITS.hosts) return { error: `Até ${MEETUP_LIMITS.hosts} pessoas conduzindo.` };
  if (hosts.some((h) => !/^[a-z0-9_.-]{1,40}$/.test(h))) return { error: "Quem conduz: use o @ da pessoa no HackaHub." };

  return { value: { kind, title, description, startsAt, endsAt, location, onlineUrl: online.value, embedUrl, capacity, hosts } };
}

// ---------- leitura ----------

const SELECT_MEETUP = `SELECT mt.id, mt.communityId AS "communityId", c.slug AS "communitySlug", c.name AS "communityName",
    c.hidden AS "communityHidden", mt.kind, mt.title, mt.description, mt.startsAt AS "startsAt", mt.endsAt AS "endsAt",
    mt.location, mt.onlineUrl AS "onlineUrl", mt.embedUrl AS "embedUrl", mt.capacity, mt.createdBy AS "createdBy",
    mt.publishedAt AS "publishedAt", mt.cancelledAt AS "cancelledAt", mt.sequence, mt.createdAt AS "createdAt",
    mt.updatedAt AS "updatedAt"
  FROM meetups mt JOIN communities c ON c.id = mt.communityId`;

const toMeetup = (r: MeetupRow): Meetup => ({ ...r, communityHidden: r.communityHidden === 1 });

/** id da rota ("12") → número, ou null */
export function meetupIdParam(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

export async function getMeetup(id: number): Promise<Meetup | null> {
  const r = await db.prepare(`${SELECT_MEETUP} WHERE mt.id = ?`).get<MeetupRow>(id);
  return r ? toMeetup(r) : null;
}

export type MeetupListItem = Meetup & { going: number; maybe: number };

const SELECT_LIST = `SELECT x.*,
    (SELECT COUNT(*)::int FROM meetup_rsvps r WHERE r.meetupId = x.id AND r.status = 'vou') AS going,
    (SELECT COUNT(*)::int FROM meetup_rsvps r WHERE r.meetupId = x.id AND r.status = 'talvez') AS maybe
  FROM (${SELECT_MEETUP}) x`;

/**
 * Agenda da comunidade: próximos (inclui o que está rolando e os cancelados
 * que ainda não passaram, marcados), passados (mais novo primeiro) e, pra
 * quem organiza, os rascunhos.
 */
export async function listCommunityMeetups(
  communityId: number,
  opts: { includeDrafts?: boolean; now?: Date; pastLimit?: number } = {},
): Promise<{ upcoming: MeetupListItem[]; past: MeetupListItem[]; drafts: MeetupListItem[] }> {
  const now = opts.now ?? new Date();
  const rows = (
    await db
      .prepare(`${SELECT_LIST} WHERE x."communityId" = ? ORDER BY to_ts(x."startsAt"), x.id`)
      .all<MeetupRow & { going: number; maybe: number }>(communityId)
  ).map((r): MeetupListItem => ({ ...r, communityHidden: r.communityHidden === 1 }));
  const drafts = opts.includeDrafts ? rows.filter((m) => !m.publishedAt) : [];
  const published = rows.filter((m) => m.publishedAt);
  const upcoming = published.filter((m) => !isMeetupOver(m, now));
  const past = published
    .filter((m) => isMeetupOver(m, now))
    .reverse()
    .slice(0, opts.pastLimit ?? 30);
  return { upcoming, past, drafts };
}

/** bloco "Próximos na agenda" da página da comunidade: publicados, sem cancelado */
export async function upcomingMeetups(communityId: number, limit = 3, now = new Date()): Promise<MeetupListItem[]> {
  const { upcoming } = await listCommunityMeetups(communityId, { now, pastLimit: 0 });
  return upcoming.filter((m) => !m.cancelledAt).slice(0, limit);
}

export async function rsvpCounts(meetupId: number): Promise<{ vou: number; talvez: number }> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE status = 'vou')::int AS vou, COUNT(*) FILTER (WHERE status = 'talvez')::int AS talvez
       FROM meetup_rsvps WHERE meetupId = ?`,
    )
    .get<{ vou: number; talvez: number }>(meetupId);
  return { vou: r?.vou ?? 0, talvez: r?.talvez ?? 0 };
}

export async function myRsvp(meetupId: number, memberId: number): Promise<RsvpStatus | null> {
  const r = await db
    .prepare("SELECT status FROM meetup_rsvps WHERE meetupId = ? AND memberId = ?")
    .get<{ status: RsvpStatus }>(meetupId, memberId);
  return r?.status ?? null;
}

export type MeetupPerson = { memberId: number; username: string; name: string | null; avatarUrl: string | null };

/** quem conduz, pra mostrar. Só quem pode aparecer na rede (canNetwork). */
export async function listHosts(meetupId: number): Promise<MeetupPerson[]> {
  const rows = await db
    .prepare(
      `SELECT m.id AS "memberId", m.username, m.name, m.avatarUrl AS "avatarUrl"
       FROM meetup_hosts h JOIN members m ON m.id = h.memberId
       WHERE h.meetupId = ? ORDER BY m.username`,
    )
    .all<MeetupPerson>(meetupId);
  const ok = await Promise.all(rows.map((r) => canNetwork(r.memberId)));
  return rows.filter((_, i) => ok[i]);
}

export async function isHost(meetupId: number, memberId: number): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS y FROM meetup_hosts WHERE meetupId = ? AND memberId = ?").get(meetupId, memberId);
  return !!r;
}

// ---------- escrita: criar, editar, publicar, cancelar ----------

async function resolveHosts(usernames: string[]): Promise<number[]> {
  if (usernames.length === 0) return [];
  const rows = await db
    .prepare(`SELECT id, username FROM members WHERE lower(username) = ANY(?::text[]) AND clerkId NOT LIKE 'deleted:%'`)
    .all<{ id: number; username: string }>(`{${usernames.join(",")}}`);
  const found = new Map(rows.map((r) => [r.username.toLowerCase(), r.id]));
  const missing = usernames.find((u) => !found.has(u));
  if (missing) throw new MeetupError(400, `Não achamos @${missing} no HackaHub.`);
  const ids = usernames.map((u) => found.get(u)!);
  const ok = await Promise.all(ids.map((id) => canNetwork(id)));
  const blocked = usernames.find((_, i) => !ok[i]);
  if (blocked) throw new MeetupError(400, `@${blocked} não pode conduzir agora.`);
  return ids;
}

async function writeHosts(meetupId: number, ids: number[]) {
  await db.prepare("DELETE FROM meetup_hosts WHERE meetupId = ?").run(meetupId);
  for (const id of ids) {
    await db.prepare("INSERT INTO meetup_hosts (meetupId, memberId) VALUES (?, ?) ON CONFLICT DO NOTHING").run(meetupId, id);
  }
}

const rowFields = (i: MeetupInput) => ({
  kind: i.kind,
  title: i.title,
  description: i.description,
  startsAt: i.startsAt,
  endsAt: i.endsAt,
  location: i.location,
  onlineUrl: i.onlineUrl,
  embedUrl: i.embedUrl,
  capacity: i.capacity,
});

/** cria (rascunho, ou já publicado com publish) */
export async function createMeetup(
  community: Pick<Community, "id" | "name" | "slug">,
  by: number,
  input: MeetupInput,
  opts: { publish?: boolean } = {},
): Promise<{ id: number; notified: number }> {
  const hostIds = await resolveHosts(input.hosts);
  const id = await db.transaction(async () => {
    const row = await db
      .prepare(
        `INSERT INTO meetups (communityId, kind, title, description, startsAt, endsAt, location, onlineUrl, embedUrl, capacity, createdBy)
         VALUES (@c, @kind, @title, @description, @startsAt, @endsAt, @location, @onlineUrl, @embedUrl, @capacity, @by)
         RETURNING id`,
      )
      .get<{ id: number }>({ c: community.id, by, ...rowFields(input) });
    await writeHosts(row!.id, hostIds.length ? hostIds : [by]);
    return row!.id;
  })();
  const notified = opts.publish ? ((await publishMeetup(id))?.notified ?? 0) : 0;
  return { id, notified };
}

/**
 * Edita. Se o horário de um evento publicado mudou, o .ics sobe a SEQUENCE
 * e quem respondeu recebe o aviso.
 */
export async function updateMeetup(m: Meetup, by: number, input: MeetupInput): Promise<{ timeChanged: boolean; notified: number }> {
  if (m.cancelledAt) throw new MeetupError(409, "Este evento foi cancelado.");
  const hostIds = await resolveHosts(input.hosts);
  const timeChanged = m.startsAt !== input.startsAt || (m.endsAt ?? null) !== input.endsAt;
  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE meetups SET kind = @kind, title = @title, description = @description, startsAt = @startsAt, endsAt = @endsAt,
           location = @location, onlineUrl = @onlineUrl, embedUrl = @embedUrl, capacity = @capacity,
           sequence = sequence + @bump, updatedAt = sqlite_now()
         WHERE id = @id`,
      )
      .run({ id: m.id, bump: timeChanged ? 1 : 0, ...rowFields(input) });
    await writeHosts(m.id, hostIds.length ? hostIds : [m.createdBy ?? by]);
    // palco só existe no demo day: mudou o tipo, os pedidos saem
    if (input.kind !== "demo_day" && m.kind === "demo_day") {
      await db.prepare("DELETE FROM meetup_stage_requests WHERE meetupId = ?").run(m.id);
    }
  })();
  let notified = 0;
  if (timeChanged && m.publishedAt) {
    const ids = await rsvpMemberIds(m.id);
    const text = `${m.communityName}: ${input.title} mudou de horário. Agora é ${fmtMeetupWhen(input.startsAt)}.`;
    for (const id of ids) await notify(id, { type: "meetup", actorId: by, text, href: `/agenda/${m.id}` });
    notified = ids.filter((id) => id !== by).length;
  }
  return { timeChanged, notified };
}

async function rsvpMemberIds(meetupId: number): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT r.memberId AS id FROM meetup_rsvps r JOIN members m ON m.id = r.memberId
       WHERE r.meetupId = ? AND m.clerkId NOT LIKE 'deleted:%' ORDER BY r.memberId`,
    )
    .all<{ id: number }>(meetupId);
  return rows.map((r) => r.id);
}

/**
 * Publica e avisa membros e quem segue (communityAudience), menos quem
 * publicou. Idempotente: publicar de novo não avisa outra vez (null).
 * Comunidade escondida não publica.
 */
export async function publishMeetup(id: number): Promise<{ notified: number } | null> {
  return db.transaction(async () => {
    const m = await db
      .prepare(
        `UPDATE meetups mt SET publishedAt = sqlite_now()
         FROM communities c
         WHERE mt.id = ? AND mt.publishedAt IS NULL AND mt.cancelledAt IS NULL AND c.id = mt.communityId AND c.hidden = 0
         RETURNING mt.id, mt.kind, mt.title, mt.startsAt AS "startsAt", mt.createdBy AS "createdBy", c.id AS "communityId", c.name AS "communityName"`,
      )
      .get<{ id: number; kind: MeetupKind; title: string; startsAt: string; createdBy: number | null; communityId: number; communityName: string }>(id);
    if (!m) return null;
    const ids = (await communityAudience(m.communityId)).filter((x) => x !== m.createdBy);
    if (ids.length === 0) return { notified: 0 };
    const text = `${m.communityName} marcou ${m.kind === "live" ? "uma" : "um"} ${MEETUP_KIND_LABEL[m.kind]}: ${m.title}, ${fmtMeetupWhen(m.startsAt)}.`;
    const res = await db
      .prepare(
        `INSERT INTO notifications (memberId, actorId, type, text, href)
         SELECT id, ?::int, 'meetup', ?, ? FROM members WHERE id = ANY(?::int[])`,
      )
      .run(m.createdBy, text, `/agenda/${m.id}`, `{${ids.join(",")}}`);
    return { notified: res.changes };
  })();
}

/** cancela um publicado e avisa quem respondeu. Repetir é 409. */
export async function cancelMeetup(m: Meetup, by: number): Promise<{ notified: number }> {
  if (!m.publishedAt) throw new MeetupError(409, "Rascunho não se cancela: apague.");
  const r = await db
    .prepare("UPDATE meetups SET cancelledAt = sqlite_now(), updatedAt = sqlite_now() WHERE id = ? AND cancelledAt IS NULL RETURNING id")
    .get<{ id: number }>(m.id);
  if (!r) throw new MeetupError(409, "Este evento já foi cancelado.");
  const ids = (await rsvpMemberIds(m.id)).filter((id) => id !== by);
  const text = `${m.communityName} cancelou ${m.title} (${fmtMeetupWhen(m.startsAt)}).`;
  for (const id of ids) await notify(id, { type: "meetup_cancelado", actorId: by, text, href: `/agenda/${m.id}` });
  return { notified: ids.length };
}

/** apaga um rascunho (publicado só cancela) */
export async function deleteDraft(m: Meetup): Promise<void> {
  if (m.publishedAt) throw new MeetupError(409, "Evento publicado não se apaga: cancele.");
  await db.prepare("DELETE FROM meetups WHERE id = ? AND publishedAt IS NULL").run(m.id);
}

// ---------- RSVP ----------

function assertOpen(m: Meetup, now = new Date()) {
  if (!m.publishedAt) throw new MeetupError(404, "Evento não encontrado");
  if (m.cancelledAt) throw new MeetupError(409, "Este evento foi cancelado.");
  if (isMeetupOver(m, now)) throw new MeetupError(409, "Este evento já passou.");
}

/**
 * "vou" ou "talvez". Lotação cheia: "vou" vira "talvez" e volta full = true
 * (a tela mostra "lotado"). A linha do evento fica travada durante a conta,
 * então dois "vou" simultâneos não passam da lotação.
 */
export async function setRsvp(
  m: Meetup,
  memberId: number,
  status: RsvpStatus,
  now = new Date(),
): Promise<{ status: RsvpStatus; full: boolean }> {
  assertOpen(m, now);
  return db.transaction(async () => {
    const row = await db
      .prepare("SELECT capacity FROM meetups WHERE id = ? FOR UPDATE")
      .get<{ capacity: number | null }>(m.id);
    let final = status;
    let full = false;
    if (status === "vou" && row?.capacity != null) {
      const c = await db
        .prepare("SELECT COUNT(*)::int AS n FROM meetup_rsvps WHERE meetupId = ? AND status = 'vou' AND memberId <> ?")
        .get<{ n: number }>(m.id, memberId);
      if ((c?.n ?? 0) >= row.capacity) {
        final = "talvez";
        full = true;
      }
    }
    await db
      .prepare(
        `INSERT INTO meetup_rsvps (meetupId, memberId, status) VALUES (?, ?, ?)
         ON CONFLICT (meetupId, memberId) DO UPDATE SET status = excluded.status`,
      )
      .run(m.id, memberId, final);
    return { status: final, full };
  })();
}

export async function clearRsvp(meetupId: number, memberId: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM meetup_rsvps WHERE meetupId = ? AND memberId = ?").run(meetupId, memberId);
  return r.changes > 0;
}

// ---------- palco do demo day ----------

export type MyProject = { teamId: number; title: string; teamName: string; hackathonName: string };

/** projetos da pessoa: times dela que têm projeto cadastrado */
export async function myProjects(username: string): Promise<MyProject[]> {
  return db
    .prepare(
      `SELECT t.id AS "teamId", p.title, t.name AS "teamName", h.name AS "hackathonName"
       FROM team_members tm JOIN teams t ON t.id = tm.teamId JOIN team_projects p ON p.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE tm.username = ? ORDER BY t.id DESC LIMIT 50`,
    )
    .all<MyProject>(username);
}

export type StageRequest = {
  id: number;
  teamId: number;
  title: string;
  teamName: string;
  pitch: string;
  status: StageStatus;
  createdAt: string;
  memberId: number;
  username: string;
  name: string | null;
};

/** pedido de palco: só no demo day aberto, só com projeto de um time da pessoa (senão 403) */
export async function requestStage(
  m: Meetup,
  member: Pick<Member, "id" | "username">,
  teamId: unknown,
  pitch: unknown,
  now = new Date(),
): Promise<{ id: number }> {
  if (m.kind !== "demo_day") throw new MeetupError(400, "Pedido de palco é só no demo day.");
  assertOpen(m, now);
  const tid = typeof teamId === "number" ? teamId : Number(teamId);
  if (!Number.isInteger(tid) || tid <= 0) throw new MeetupError(400, "Escolha um projeto.");
  const text = typeof pitch === "string" ? pitch.trim().replace(/\s+/g, " ") : "";
  if (!text) throw new MeetupError(400, "Conte em uma frase o que vocês vão mostrar.");
  if (text.length > MEETUP_LIMITS.pitch) throw new MeetupError(400, `Pitch: até ${MEETUP_LIMITS.pitch} caracteres.`);
  const mine = (await myProjects(member.username)).some((p) => p.teamId === tid);
  if (!mine) throw new MeetupError(403, "Só dá pra pedir palco com um projeto do seu time.");
  const r = await db
    .prepare(
      `INSERT INTO meetup_stage_requests (meetupId, memberId, teamId, pitch) VALUES (?, ?, ?, ?)
       ON CONFLICT (meetupId, teamId) DO NOTHING RETURNING id`,
    )
    .get<{ id: number }>(m.id, member.id, tid, text);
  if (!r) throw new MeetupError(409, "Esse projeto já pediu palco neste demo day.");
  return { id: r.id };
}

export async function listStageRequests(meetupId: number, opts: { status?: StageStatus } = {}): Promise<StageRequest[]> {
  return db
    .prepare(
      `SELECT s.id, s.teamId AS "teamId", p.title, t.name AS "teamName", s.pitch, s.status, s.createdAt AS "createdAt",
              s.memberId AS "memberId", m.username, m.name
       FROM meetup_stage_requests s JOIN teams t ON t.id = s.teamId JOIN team_projects p ON p.teamId = t.id
       JOIN members m ON m.id = s.memberId
       WHERE s.meetupId = ? AND (?::text IS NULL OR s.status = ?::text)
       ORDER BY CASE s.status WHEN 'aceito' THEN 0 WHEN 'pedido' THEN 1 ELSE 2 END, s.id`,
    )
    .all<StageRequest>(meetupId, opts.status ?? null, opts.status ?? null);
}

export async function myStageRequests(meetupId: number, memberId: number): Promise<StageRequest[]> {
  return (await listStageRequests(meetupId)).filter((s) => s.memberId === memberId);
}

/** organizador aceita ou recusa; quem pediu recebe o aviso */
export async function decideStage(m: Meetup, requestId: number, status: unknown, by: number): Promise<{ status: StageStatus }> {
  if (status !== "aceito" && status !== "recusado") throw new MeetupError(400, "Decida: aceito ou recusado.");
  const r = await db
    .prepare(
      `UPDATE meetup_stage_requests SET status = ?, decidedAt = sqlite_now()
       WHERE id = ? AND meetupId = ? RETURNING memberId AS "memberId", teamId AS "teamId"`,
    )
    .get<{ memberId: number; teamId: number }>(status, requestId, m.id);
  if (!r) throw new MeetupError(404, "Pedido não encontrado");
  const text =
    status === "aceito"
      ? `Seu projeto entrou na programação de ${m.title}.`
      : `O pedido de palco em ${m.title} não entrou desta vez.`;
  await notify(r.memberId, { type: "meetup_palco", actorId: by, text, href: `/agenda/${m.id}` });
  return { status };
}

// ---------- .ics ----------

export function meetupIcs(m: Meetup): string {
  const where = m.location ?? (m.onlineUrl || m.embedUrl ? "online" : undefined);
  const url = absoluteUrl(`/agenda/${m.id}`);
  const ev: IcsEvent = {
    uid: `meetup-${m.id}@hackahub`,
    startsAt: m.startsAt,
    endsAt: m.endsAt ?? toDbUtc(meetupEnd(m)),
    stamp: m.updatedAt ?? m.publishedAt ?? m.createdAt,
    sequence: m.sequence,
    summary: `${m.title} · ${m.communityName}`,
    description: [m.description, `Detalhes e link da sala: ${url}`].filter(Boolean).join("\n\n"),
    location: where,
    url,
    categories: [MEETUP_KIND_LABEL[m.kind]],
  };
  return buildIcs({ events: [ev] });
}

// ---------- guardas das rotas ----------

type GuardOk = { member: Member; meetup: Meetup; canManage: boolean };
type GuardFail = { response: Response };
const json = (error: string, status: number) => Response.json({ error }, { status });

/** pode ver? rascunho só quem organiza; comunidade escondida só o admin */
export function canSeeMeetup(m: Meetup, viewer: { role: string } | null, canManage: boolean): boolean {
  if (m.communityHidden && viewer?.role !== "admin") return false;
  return !!m.publishedAt || canManage;
}

/**
 * 401 deslogado; 404 evento que não existe, rascunho alheio ou comunidade
 * escondida; 403 quando need = 'manage' e a pessoa não organiza a comunidade.
 */
export async function requireMeetup(rawId: string, need: "view" | "manage"): Promise<GuardOk | GuardFail> {
  const member = await currentMember();
  if (!member) return { response: json("Unauthorized", 401) };
  const id = meetupIdParam(rawId);
  const meetup = id ? await getMeetup(id) : null;
  if (!meetup) return { response: json("Evento não encontrado", 404) };
  const canManage = await canManageCommunity(member, meetup.communityId);
  if (!canSeeMeetup(meetup, member, canManage)) return { response: json("Evento não encontrado", 404) };
  if (need === "manage" && !canManage) return { response: json("Forbidden", 403) };
  return { member, meetup, canManage };
}

/** MeetupError vira a resposta JSON certa; o resto sobe */
export function meetupErrorResponse(e: unknown): Response {
  if (e instanceof MeetupError) return json(e.message, e.status);
  throw e;
}
