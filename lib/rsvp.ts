import { createHmac, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { emailDriver } from "@/lib/notify/email";
import { whatsappDriver } from "@/lib/notify/whatsapp";
import { normalizeBrPhone } from "@/lib/notify/phone";
import type { DriverEnv, SendOutcome } from "@/lib/notify/types";
import { refillFromWaitlist, unregister } from "@/lib/registrations";
import { absoluteUrl } from "@/lib/seo";
import {
  renderRsvpEmail,
  renderRsvpWhatsapp,
  rsvpInappText,
  type RsvpMessageInput,
  type RsvpMessageKind,
} from "@/lib/rsvpMessages";

// RSVP anti-no-show (roadmap 037 Onda 1 #1, pesquisa 035 #1 + diferencial 1).
//
// Ciclo, todo no fuso America/Sao_Paulo (D-n = dias de calendário antes do
// dia do evento):
//  - D-7 às 09:00 (rsvpOpensDaysBefore): cada aprovado vira rsvpStatus
//    'pending' e recebe "confirmo / não vou" (in-app + e-mail + WhatsApp com
//    opt-in) com link assinado, sem login, que expira no prazo.
//  - prazo = fim do D-3 (23:59:59; rsvpDeadlineDaysBefore). Sem resposta,
//    a vaga é liberada e a fila de espera anda (lógica de registrations.ts).
//  - quem entra depois de aberta a janela (saiu da fila, aprovado tarde)
//    é convidado na hora e tem pelo menos 24h: prazo = max(prazo geral,
//    agora + 24h), nunca depois do início do evento. Decisão: o promovido
//    NÃO entra confirmado — sem confirmação ele vira o próximo no-show.
//  - "não vou" libera a vaga na hora (mesmo caminho do cancelamento:
//    unregister promove a fila) e fica registrado em rsvp_releases.
//  - D-1 às 09:00: lembrete de logística; H-2: endereço + ingresso. Só pra
//    'confirmed', uma vez cada (rsvpReminderStage é a trava).
//  - depois do início nada expira nem promove: liberar vaga com o evento
//    rolando só gera aviso inútil pra quem está na fila.
//
// processRsvp(now) é idempotente (toda transição é UPDATE/DELETE
// condicional) e roda por cron: POST /api/cron/rsvp a cada 15 min.

export const RSVP_TZ = "America/Sao_Paulo";
export type RsvpStatus = "pending" | "confirmed" | "declined" | "expired";

export type RsvpConfig = {
  enabled: boolean;
  opensDaysBefore: number;
  deadlineDaysBefore: number;
  overbookPercent: number;
};

export const DEFAULT_RSVP_CONFIG: RsvpConfig = {
  enabled: false,
  opensDaysBefore: 7,
  deadlineDaysBefore: 3,
  overbookPercent: 0,
};

/** quem sai da fila/é aprovado tarde tem pelo menos isso pra responder */
export const LATE_INVITE_HOURS = 24;
/** reenvio manual pelo organizador: no máximo um a cada N minutos por pessoa */
export const RESEND_COOLDOWN_MIN = 5;

// ---------- tempo (fuso de Brasília) ----------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
export const fromSqlTime = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: RSVP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function spParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}

/** diferença (ms) entre o relógio de Brasília e UTC naquele instante */
function spOffset(d: Date): number {
  const p = spParts(d);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(d.getTime() / 1000) * 1000;
}

/** instante de um horário de parede em Brasília (dia pode "transbordar": d=0, d=-3…) */
export function spWallTime(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const first = guess - spOffset(new Date(guess));
  return new Date(guess - spOffset(new Date(first)));
}

/**
 * startsAt vem em formatos diferentes: ISO com fuso ("2026-11-14T09:00:00-03:00"),
 * texto do banco sem fuso ("2026-11-14 12:00:00" = UTC, convenção do schema)
 * ou só a data ("2027-01-01" = 09:00 em Brasília, horário típico de abertura).
 */
export function parseEventStart(s: string | null | undefined): Date | null {
  if (!s) return null;
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return spWallTime(+dateOnly[1], +dateOnly[2], +dateOnly[3], 9, 0, 0);
  const t = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)
    ? new Date(`${s.replace(" ", "T")}Z`)
    : new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
}

export type RsvpWindows = {
  start: Date;
  /** convite sai a partir daqui (D-n 09:00) */
  opensAt: Date;
  /** prazo geral: fim do D-n (exclusivo), nunca depois do início */
  deadlineAt: Date;
  /** lembrete de logística (D-1 09:00) */
  d1At: Date;
  /** lembrete de endereço + ingresso (início - 2h) */
  h2At: Date;
};

export function rsvpWindows(
  startsAt: string,
  cfg: Pick<RsvpConfig, "opensDaysBefore" | "deadlineDaysBefore">,
): RsvpWindows | null {
  const start = parseEventStart(startsAt);
  if (!start) return null;
  const day = spParts(start);
  const opensAt = spWallTime(day.y, day.m, day.d - cfg.opensDaysBefore, 9);
  const endOfDeadlineDay = spWallTime(day.y, day.m, day.d - cfg.deadlineDaysBefore + 1, 0);
  const h2At = new Date(start.getTime() - 2 * HOUR);
  const d1 = spWallTime(day.y, day.m, day.d - 1, 9);
  return {
    start,
    opensAt,
    deadlineAt: new Date(Math.min(endOfDeadlineDay.getTime(), start.getTime())),
    d1At: new Date(Math.min(d1.getTime(), h2At.getTime())),
    h2At,
  };
}

/** prazo individual de quem é convidado agora */
export function personalDeadline(w: RsvpWindows, now: Date): Date {
  const late = now.getTime() + LATE_INVITE_HOURS * HOUR;
  return new Date(Math.min(Math.max(w.deadlineAt.getTime(), late), w.start.getTime()));
}

const humanFmt = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: RSVP_TZ,
});

/** "sáb, 14 de nov, 09:00" no fuso de Brasília */
export function formatSp(d: Date): string {
  return humanFmt.format(d).replace(/\./g, "");
}

/** prazo é exclusivo (00:00 do dia seguinte); pra gente mostrar 23:59 do dia */
export function formatDeadline(d: Date): string {
  return formatSp(new Date(d.getTime() - 60_000));
}

// ---------- configuração por edição ----------

type ConfigRow = {
  rsvpEnabled: number;
  rsvpOpensDaysBefore: number;
  rsvpDeadlineDaysBefore: number;
  overbookPercent: number;
};

export async function getRsvpConfig(hackathonId: string): Promise<RsvpConfig | null> {
  const row = await db
    .prepare(
      `SELECT rsvpEnabled, rsvpOpensDaysBefore, rsvpDeadlineDaysBefore, overbookPercent
       FROM hackathons WHERE id = ?`,
    )
    .get<ConfigRow>(hackathonId);
  if (!row) return null;
  return {
    enabled: row.rsvpEnabled === 1,
    opensDaysBefore: row.rsvpOpensDaysBefore,
    deadlineDaysBefore: row.rsvpDeadlineDaysBefore,
    overbookPercent: row.overbookPercent,
  };
}

export function validateRsvpConfig(raw: unknown): RsvpConfig {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, name: string, min: number, max: number) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}`);
    }
    return n;
  };
  if (typeof b.enabled !== "boolean") throw new Error("enabled deve ser true ou false");
  const opensDaysBefore = int(b.opensDaysBefore, "abertura (dias antes)", 1, 60);
  const deadlineDaysBefore = int(b.deadlineDaysBefore, "prazo (dias antes)", 0, 59);
  if (deadlineDaysBefore >= opensDaysBefore) {
    throw new Error("o prazo tem que ser depois da abertura (menos dias antes do evento)");
  }
  const overbookPercent = int(b.overbookPercent, "sobrevenda (%)", 0, 100);
  return { enabled: b.enabled, opensDaysBefore, deadlineDaysBefore, overbookPercent };
}

/** salva e, se a sobrevenda aumentou a capacidade efetiva, a fila anda na hora */
export async function setRsvpConfig(hackathonId: string, cfg: RsvpConfig): Promise<{ promoted: number }> {
  await db
    .prepare(
      `UPDATE hackathons SET rsvpEnabled = ?, rsvpOpensDaysBefore = ?, rsvpDeadlineDaysBefore = ?,
         overbookPercent = ? WHERE id = ?`,
    )
    .run(cfg.enabled ? 1 : 0, cfg.opensDaysBefore, cfg.deadlineDaysBefore, cfg.overbookPercent, hackathonId);
  const promoted = await refillFromWaitlist(hackathonId);
  return { promoted: promoted.length };
}

// ---------- token assinado ----------
// R1.<registrationId base36>.<expiração unix base36>.<HMAC-SHA256 base64url>.
// O id vai no token (é o que liga o link à inscrição), mas sem o segredo
// ninguém forja nem estende a validade. Domínio separado ("rsvp:v1") do
// HMAC do ingresso: um token nunca vale pelo outro.

const TOKEN_RE = /^R1\.([0-9a-z]{1,12})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{43})$/;
const DEV_SECRET = "hackahub-dev-rsvp-secret-nao-usar-em-producao";

export function rsvpSecret(): string {
  const s = process.env.HACKAHUB_RSVP_SECRET || process.env.HACKAHUB_TICKET_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("HACKAHUB_RSVP_SECRET (ou HACKAHUB_TICKET_SECRET) ausente — obrigatório em produção");
  }
  return DEV_SECRET;
}

const mac = (registrationId: number, exp: number) =>
  createHmac("sha256", rsvpSecret()).update(`rsvp:v1:${registrationId}:${exp}`).digest("base64url");

export function rsvpToken(registrationId: number, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return `R1.${registrationId.toString(36)}.${exp.toString(36)}.${mac(registrationId, exp)}`;
}

export type TokenCheck =
  | { ok: true; registrationId: number; expiresAt: Date }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "expired"; registrationId: number; expiresAt: Date };

export function verifyRsvpToken(token: unknown, now = new Date()): TokenCheck {
  if (typeof token !== "string") return { ok: false, reason: "invalid" };
  const m = token.match(TOKEN_RE);
  if (!m) return { ok: false, reason: "invalid" };
  const registrationId = parseInt(m[1], 36);
  const exp = parseInt(m[2], 36);
  if (!Number.isSafeInteger(registrationId) || registrationId <= 0 || !Number.isSafeInteger(exp)) {
    return { ok: false, reason: "invalid" };
  }
  const expected = Buffer.from(mac(registrationId, exp));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "invalid" };
  }
  const expiresAt = new Date(exp * 1000);
  if (now.getTime() >= expiresAt.getTime()) return { ok: false, reason: "expired", registrationId, expiresAt };
  return { ok: true, registrationId, expiresAt };
}

export const rsvpUrl = (token: string) => absoluteUrl(`/rsvp/${token}`);

// ---------- leitura da inscrição ----------

type RegRow = {
  id: number;
  memberId: number;
  hackathonId: string;
  status: string;
  rsvpStatus: RsvpStatus | null;
  rsvpAt: string | null;
  rsvpDeadlineAt: string | null;
  rsvpReminderStage: number;
  hackathonName: string;
  startsAt: string;
  location: string | null;
  rsvpOpensDaysBefore: number;
  rsvpDeadlineDaysBefore: number;
  firstName: string | null;
  email: string;
  phone: string | null;
  whatsappOptIn: number;
  emailBouncedAt: string | null;
};

const REG_SELECT = `SELECT r.id, r.memberId, r.hackathonId, r.status, r.rsvpStatus, r.rsvpAt,
    r.rsvpDeadlineAt, r.rsvpReminderStage, h.name AS hackathonName, h.startsAt, h.location,
    h.rsvpOpensDaysBefore, h.rsvpDeadlineDaysBefore, m.name AS firstName, m.email, m.phone,
    m.whatsappOptIn, m.emailBouncedAt
  FROM registrations r
  JOIN hackathons h ON h.id = r.hackathonId
  JOIN members m ON m.id = r.memberId`;

const firstWord = (s: string | null) => (s ? s.trim().split(/\s+/)[0] || null : null);

type Release = { outcome: "declined" | "expired"; at: string; hackathonId: string; hackathonName: string };

async function findRelease(registrationId: number): Promise<Release | null> {
  return (
    (await db
      .prepare(
        `SELECT x.outcome, x.at, x.hackathonId, h.name AS hackathonName
         FROM rsvp_releases x JOIN hackathons h ON h.id = x.hackathonId
         WHERE x.registrationId = ?`,
      )
      .get<Release>(registrationId)) ?? null
  );
}

export type RsvpView =
  | { kind: "invalid" }
  | { kind: "expired"; hackathonName: string | null; status: RsvpStatus | null }
  | { kind: "not_found" }
  | { kind: "released"; outcome: "declined" | "expired"; at: string; hackathonId: string; hackathonName: string }
  | {
      kind: "open";
      registrationId: number;
      hackathonId: string;
      hackathonName: string;
      firstName: string | null;
      when: string;
      location: string | null;
      status: RsvpStatus | null;
      deadline: string | null;
      /** ainda dá pra confirmar? (pendente e dentro do prazo) */
      canConfirm: boolean;
      /** ainda dá pra liberar a vaga? (até o início) */
      canDecline: boolean;
      started: boolean;
    };

/** o que a página /rsvp/[token] mostra — nunca muda nada */
export async function getRsvpView(token: string, now = new Date()): Promise<RsvpView> {
  const t = verifyRsvpToken(token, now);
  if (!t.ok && t.reason === "invalid") return { kind: "invalid" };
  const reg = await db.prepare(`${REG_SELECT} WHERE r.id = ?`).get<RegRow>(t.registrationId);
  if (!t.ok) {
    return { kind: "expired", hackathonName: reg?.hackathonName ?? null, status: reg?.rsvpStatus ?? null };
  }
  if (!reg) {
    const rel = await findRelease(t.registrationId);
    return rel ? { kind: "released", ...rel } : { kind: "not_found" };
  }
  const start = parseEventStart(reg.startsAt);
  const started = !!start && now.getTime() >= start.getTime();
  const deadline = reg.rsvpDeadlineAt ? fromSqlTime(reg.rsvpDeadlineAt) : null;
  const live = reg.status === "approved" && reg.rsvpStatus !== null;
  return {
    kind: "open",
    registrationId: reg.id,
    hackathonId: reg.hackathonId,
    hackathonName: reg.hackathonName,
    firstName: firstWord(reg.firstName),
    when: start ? formatSp(start) : reg.startsAt,
    location: reg.location,
    status: reg.rsvpStatus,
    deadline: deadline ? formatDeadline(deadline) : null,
    canConfirm:
      live && reg.rsvpStatus === "pending" && !started && !!deadline && now.getTime() < deadline.getTime(),
    canDecline: live && !started,
    started,
  };
}

// ---------- confirmar / recusar ----------

export type RsvpAction = "confirm" | "decline";
export type RsvpResult =
  | { ok: true; status: "confirmed"; already: boolean }
  | { ok: true; status: "declined"; already: boolean; promoted: number }
  | { ok: false; reason: "invalid" | "expired" | "not_found" | "not_invited" | "closed" | "released" };

/**
 * Resposta pelo link. Idempotente: confirmar de novo é already=true;
 * recusar de novo (a linha já saiu) reconhece a liberação pelo
 * registrationId e devolve already=true. Confirmado pode mudar de ideia e
 * liberar a vaga até o início; quem recusou não volta — a vaga já foi.
 */
export async function respondRsvp(
  token: string,
  action: RsvpAction,
  now = new Date(),
  env: DriverEnv = process.env,
): Promise<RsvpResult> {
  const t = verifyRsvpToken(token, now);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (action === "confirm") return confirmRegistration(t.registrationId, now);
  const res = await releaseRegistration(t.registrationId, "declined", now);
  if (res.ok && res.status === "declined" && !res.already) {
    // quem subiu da fila é convidado agora, sem esperar o cron
    await processEdition(res.hackathonId, now, env);
  }
  if (!res.ok) return res;
  return { ok: true, status: "declined", already: res.already, promoted: res.promoted };
}

async function confirmRegistration(registrationId: number, now: Date): Promise<RsvpResult> {
  return db.transaction(async (): Promise<RsvpResult> => {
    const reg = await db
      .prepare(
        `SELECT r.status, r.rsvpStatus, r.rsvpDeadlineAt, h.startsAt
         FROM registrations r JOIN hackathons h ON h.id = r.hackathonId
         WHERE r.id = ? FOR UPDATE OF r`,
      )
      .get<{ status: string; rsvpStatus: RsvpStatus | null; rsvpDeadlineAt: string | null; startsAt: string }>(
        registrationId,
      );
    if (!reg) return { ok: false, reason: (await findRelease(registrationId)) ? "released" : "not_found" };
    if (reg.status !== "approved" || reg.rsvpStatus === null) return { ok: false, reason: "not_invited" };
    if (reg.rsvpStatus === "confirmed") return { ok: true, status: "confirmed", already: true };
    const start = parseEventStart(reg.startsAt);
    const deadline = reg.rsvpDeadlineAt ? fromSqlTime(reg.rsvpDeadlineAt) : null;
    if (!deadline || now >= deadline || (start && now >= start)) return { ok: false, reason: "closed" };
    await db
      .prepare(`UPDATE registrations SET rsvpStatus = 'confirmed', rsvpAt = ? WHERE id = ?`)
      .run(sqlTime(now), registrationId);
    return { ok: true, status: "confirmed", already: false };
  })();
}

type ReleaseResult =
  | { ok: true; status: "declined" | "expired"; already: boolean; promoted: number; hackathonId: string }
  | { ok: false; reason: "not_found" | "not_invited" | "closed" | "released" };

/**
 * Libera a vaga de uma inscrição do RSVP: mesma porta do cancelamento
 * (unregister apaga a linha e promove a fila na mesma transação) + linha
 * em rsvp_releases. Trava a edição antes da inscrição — mesma ordem do
 * register/unregister, sem deadlock.
 */
async function releaseRegistration(
  registrationId: number,
  outcome: "declined" | "expired",
  now: Date,
): Promise<ReleaseResult> {
  return db.transaction(async (): Promise<ReleaseResult> => {
    const head = await db
      .prepare("SELECT hackathonId FROM registrations WHERE id = ?")
      .get<{ hackathonId: string }>(registrationId);
    if (!head) {
      const rel = await findRelease(registrationId);
      if (!rel) return { ok: false, reason: "not_found" };
      // recusar de novo é idempotente; expirar quem já saiu é no-op
      return rel.outcome === outcome
        ? { ok: true, status: outcome, already: true, promoted: 0, hackathonId: rel.hackathonId }
        : { ok: false, reason: "released" };
    }
    const ed = await db
      .prepare("SELECT startsAt FROM hackathons WHERE id = ? FOR UPDATE")
      .get<{ startsAt: string }>(head.hackathonId);
    const reg = await db
      .prepare(
        `SELECT memberId, status, rsvpStatus, rsvpDeadlineAt FROM registrations
         WHERE id = ? FOR UPDATE`,
      )
      .get<{ memberId: number; status: string; rsvpStatus: RsvpStatus | null; rsvpDeadlineAt: string | null }>(
        registrationId,
      );
    if (!reg || !ed) return { ok: false, reason: "not_found" };
    if (reg.status !== "approved" || reg.rsvpStatus === null) return { ok: false, reason: "not_invited" };
    const start = parseEventStart(ed.startsAt);
    if (start && now >= start) return { ok: false, reason: "closed" };
    if (outcome === "expired") {
      // re-checa dentro da trava: confirmou no último segundo = fica
      const deadline = reg.rsvpDeadlineAt ? fromSqlTime(reg.rsvpDeadlineAt) : null;
      if (reg.rsvpStatus !== "pending" || !deadline || now < deadline) return { ok: false, reason: "closed" };
    }
    const { promoted } = await unregister(reg.memberId, head.hackathonId);
    await db
      .prepare(
        `INSERT INTO rsvp_releases (registrationId, hackathonId, memberId, outcome, wasConfirmed, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(registrationId, head.hackathonId, reg.memberId, outcome, reg.rsvpStatus === "confirmed" ? 1 : 0, sqlTime(now));
    return { ok: true, status: outcome, already: false, promoted: promoted.length, hackathonId: head.hackathonId };
  })();
}

// ---------- envio ----------

export type MessageStats = { sent: number; failed: number; skipped: number };
const zeroStats = (): MessageStats => ({ sent: 0, failed: 0, skipped: 0 });

type Drivers = { email: ReturnType<typeof emailDriver>; whatsapp: ReturnType<typeof whatsappDriver> };

function messageInput(reg: RegRow, kind: RsvpMessageKind, token: string, deadline: Date | null): RsvpMessageInput {
  const start = parseEventStart(reg.startsAt);
  return {
    kind,
    hackathonId: reg.hackathonId,
    hackathonName: reg.hackathonName,
    firstName: firstWord(reg.firstName),
    when: start ? formatSp(start) : reg.startsAt,
    location: reg.location,
    deadline: deadline ? formatDeadline(deadline) : undefined,
    rsvpUrl: rsvpUrl(token),
  };
}

/** in-app sempre; e-mail sem bounce; WhatsApp só com opt-in + telefone válido */
async function sendToMember(
  reg: RegRow,
  input: RsvpMessageInput,
  logKind: "invite" | "d1" | "h2" | "resend",
  drivers: Drivers,
  stats: MessageStats,
  now: Date,
): Promise<void> {
  const log = db.prepare(
    `INSERT INTO rsvp_messages (hackathonId, memberId, registrationId, kind, channel, status, error, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const record = async (channel: "inapp" | "email" | "whatsapp", out: SendOutcome) => {
    stats[out.status]++;
    const error = out.status === "failed" ? out.error : out.status === "skipped" ? out.reason : null;
    await log.run(reg.hackathonId, reg.memberId, reg.id, logKind, channel, out.status, error, sqlTime(now));
  };
  const safe = async (fn: () => Promise<SendOutcome>): Promise<SendOutcome> => {
    try {
      return await fn();
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  };

  await record(
    "inapp",
    await safe(async () => {
      await notify(reg.memberId, {
        type: `rsvp_${input.kind}`,
        text: rsvpInappText(input),
        href: input.kind === "invite" ? new URL(input.rsvpUrl).pathname : `/h/${reg.hackathonId}/ingresso`,
      });
      return { status: "sent" };
    }),
  );
  const email = renderRsvpEmail(input);
  await record(
    "email",
    reg.emailBouncedAt
      ? { status: "skipped", reason: `e-mail com bounce desde ${reg.emailBouncedAt}` }
      : !reg.email
        ? { status: "skipped", reason: "membro sem e-mail" }
        : await safe(() =>
            drivers.email.send({
              to: reg.email,
              ...email,
              idempotencyKey: `rsvp-${logKind}-reg-${reg.id}${logKind === "resend" ? `-${now.getTime()}` : ""}`,
            }),
          ),
  );
  const number = normalizeBrPhone(reg.phone ?? "");
  if (reg.whatsappOptIn === 1 && number) {
    await record("whatsapp", await safe(() => drivers.whatsapp.send({ number, text: renderRsvpWhatsapp(input) })));
  }
}

// ---------- processamento (cron) ----------

export type ProcessRsvpResult = {
  editions: number;
  invited: number;
  expired: number;
  promoted: number;
  d1: number;
  h2: number;
  messages: MessageStats;
};

const emptyResult = (): ProcessRsvpResult => ({
  editions: 0,
  invited: 0,
  expired: 0,
  promoted: 0,
  d1: 0,
  h2: 0,
  messages: zeroStats(),
});

function addResult(a: ProcessRsvpResult, b: ProcessRsvpResult) {
  a.editions += b.editions;
  a.invited += b.invited;
  a.expired += b.expired;
  a.promoted += b.promoted;
  a.d1 += b.d1;
  a.h2 += b.h2;
  a.messages.sent += b.messages.sent;
  a.messages.failed += b.messages.failed;
  a.messages.skipped += b.messages.skipped;
}

/**
 * Roda o ciclo de todas as edições com RSVP ligado. Idempotente: rodar duas
 * vezes no mesmo instante não convida, expira nem lembra ninguém de novo.
 * Frequência recomendada: a cada 15 min (o atraso máximo de um convite,
 * lembrete ou liberação de vaga é o intervalo do cron).
 */
export async function processRsvp(now = new Date(), opts: { env?: DriverEnv } = {}): Promise<ProcessRsvpResult> {
  const eds = await db
    .prepare("SELECT id FROM hackathons WHERE rsvpEnabled = 1 AND active = 1 ORDER BY id")
    .all<{ id: string }>();
  const total = emptyResult();
  for (const e of eds) addResult(total, await processEdition(e.id, now, opts.env ?? process.env));
  return total;
}

async function processEdition(hackathonId: string, now: Date, env: DriverEnv): Promise<ProcessRsvpResult> {
  const out = emptyResult();
  const ed = await db
    .prepare(
      `SELECT startsAt, rsvpEnabled, rsvpOpensDaysBefore, rsvpDeadlineDaysBefore
       FROM hackathons WHERE id = ?`,
    )
    .get<{ startsAt: string; rsvpEnabled: number; rsvpOpensDaysBefore: number; rsvpDeadlineDaysBefore: number }>(
      hackathonId,
    );
  if (!ed || ed.rsvpEnabled !== 1) return out;
  const w = rsvpWindows(ed.startsAt, {
    opensDaysBefore: ed.rsvpOpensDaysBefore,
    deadlineDaysBefore: ed.rsvpDeadlineDaysBefore,
  });
  if (!w || now < w.opensAt || now.getTime() >= w.start.getTime() + DAY) return out;
  out.editions = 1;
  const t = now.getTime();
  const drivers: Drivers = { email: emailDriver(env), whatsapp: whatsappDriver(env) };

  // 1. prazo vencido → libera vaga (antes de convidar: quem sobe da fila
  //    nesta rodada já recebe o convite no passo 2)
  if (t < w.start.getTime()) {
    const due = await db
      .prepare(
        `SELECT id FROM registrations
         WHERE hackathonId = ? AND status = 'approved' AND rsvpStatus = 'pending'
           AND to_ts(rsvpDeadlineAt) <= to_ts(?)
         ORDER BY id`,
      )
      .all<{ id: number }>(hackathonId, sqlTime(now));
    for (const r of due) {
      const res = await releaseRegistration(r.id, "expired", now);
      if (res.ok && !res.already) {
        out.expired++;
        out.promoted += res.promoted;
      }
    }
  }

  // 2. aprovados ainda não convidados (D-7, ou quem entrou depois)
  if (t < w.start.getTime()) {
    const deadline = personalDeadline(w, now);
    const fresh = await db
      .prepare(
        `UPDATE registrations SET rsvpStatus = 'pending', rsvpDeadlineAt = ?
         WHERE hackathonId = ? AND status = 'approved' AND rsvpStatus IS NULL
         RETURNING id`,
      )
      .all<{ id: number }>(sqlTime(deadline), hackathonId);
    for (const r of fresh) {
      const reg = await db.prepare(`${REG_SELECT} WHERE r.id = ?`).get<RegRow>(r.id);
      if (!reg) continue;
      out.invited++;
      const token = rsvpToken(reg.id, deadline);
      await sendToMember(reg, messageInput(reg, "invite", token, deadline), "invite", drivers, out.messages, now);
    }
  }

  // 3/4. lembretes só pra confirmados, uma vez cada; quem perdeu a janela
  //      do D-1 (confirmou tarde, cron parado) pula direto pro H-2
  const stages: { stage: 1 | 2; kind: "d1" | "h2"; from: number; until: number }[] = [
    { stage: 1, kind: "d1", from: w.d1At.getTime(), until: w.h2At.getTime() },
    { stage: 2, kind: "h2", from: w.h2At.getTime(), until: w.start.getTime() + HOUR },
  ];
  for (const s of stages) {
    if (t < s.from || t >= s.until) continue;
    const claimed = await db
      .prepare(
        `UPDATE registrations SET rsvpReminderStage = ?
         WHERE hackathonId = ? AND status = 'approved' AND rsvpStatus = 'confirmed'
           AND rsvpReminderStage < ?
         RETURNING id`,
      )
      .all<{ id: number }>(s.stage, hackathonId, s.stage);
    for (const r of claimed) {
      const reg = await db.prepare(`${REG_SELECT} WHERE r.id = ?`).get<RegRow>(r.id);
      if (!reg) continue;
      out[s.kind]++;
      const token = rsvpToken(reg.id, w.start);
      await sendToMember(reg, messageInput(reg, s.kind, token, null), s.kind, drivers, out.messages, now);
    }
  }
  return out;
}

/**
 * Reenvio individual pelo organizador: pendente recebe o convite de novo
 * (mesmo prazo); confirmado recebe a logística (D-1, ou H-2 se faltam
 * menos de 2h). Freio de RESEND_COOLDOWN_MIN por pessoa.
 */
export async function resendRsvp(
  hackathonId: string,
  memberId: number,
  now = new Date(),
  env: DriverEnv = process.env,
): Promise<
  | { ok: true; kind: RsvpMessageKind; messages: MessageStats }
  | { ok: false; reason: "not_found" | "not_invited" | "closed" | "cooldown" }
> {
  const reg = await db
    .prepare(`${REG_SELECT} WHERE r.hackathonId = ? AND r.memberId = ?`)
    .get<RegRow>(hackathonId, memberId);
  if (!reg) return { ok: false, reason: "not_found" };
  if (reg.status !== "approved" || reg.rsvpStatus === null) return { ok: false, reason: "not_invited" };
  const w = rsvpWindows(reg.startsAt, {
    opensDaysBefore: reg.rsvpOpensDaysBefore,
    deadlineDaysBefore: reg.rsvpDeadlineDaysBefore,
  });
  if (!w || now >= w.start) return { ok: false, reason: "closed" };
  const recent = await db
    .prepare(
      `SELECT 1 AS x FROM rsvp_messages
       WHERE registrationId = ? AND kind = 'resend' AND to_ts(createdAt) > to_ts(?)`,
    )
    .get(reg.id, sqlTime(new Date(now.getTime() - RESEND_COOLDOWN_MIN * 60_000)));
  if (recent) return { ok: false, reason: "cooldown" };
  const drivers: Drivers = { email: emailDriver(env), whatsapp: whatsappDriver(env) };
  const stats = zeroStats();
  let kind: RsvpMessageKind;
  let input: RsvpMessageInput;
  if (reg.rsvpStatus === "pending") {
    const deadline = reg.rsvpDeadlineAt ? fromSqlTime(reg.rsvpDeadlineAt) : null;
    if (!deadline || now >= deadline) return { ok: false, reason: "closed" };
    kind = "invite";
    input = messageInput(reg, kind, rsvpToken(reg.id, deadline), deadline);
  } else {
    kind = now >= w.h2At ? "h2" : "d1";
    input = messageInput(reg, kind, rsvpToken(reg.id, w.start), null);
  }
  await sendToMember(reg, input, "resend", drivers, stats, now);
  return { ok: true, kind, messages: stats };
}

// ---------- painel do organizador ----------

export type RsvpFunnel = {
  /** aprovados hoje + quem foi aprovado e liberou a vaga pelo RSVP */
  approved: number;
  invited: number;
  pending: number;
  confirmed: number;
  declined: number;
  expired: number;
  present: number;
  notInvited: number;
};

export async function getRsvpFunnel(hackathonId: string): Promise<RsvpFunnel> {
  const [live, rel] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS approved,
                COUNT(*) FILTER (WHERE r.rsvpStatus IS NULL) AS "notInvited",
                COUNT(*) FILTER (WHERE r.rsvpStatus = 'pending') AS pending,
                COUNT(*) FILTER (WHERE r.rsvpStatus = 'confirmed') AS confirmed,
                COUNT(c.registrationId) AS present
         FROM registrations r LEFT JOIN checkins c ON c.registrationId = r.id
         WHERE r.hackathonId = ? AND r.status = 'approved'`,
      )
      .get<{ approved: number; notInvited: number; pending: number; confirmed: number; present: number }>(hackathonId),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE outcome = 'declined') AS declined,
                COUNT(*) FILTER (WHERE outcome = 'expired') AS expired
         FROM rsvp_releases WHERE hackathonId = ?`,
      )
      .get<{ declined: number; expired: number }>(hackathonId),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  const declined = n(rel?.declined);
  const expired = n(rel?.expired);
  const approvedNow = n(live?.approved);
  const notInvited = n(live?.notInvited);
  return {
    approved: approvedNow + declined + expired,
    invited: approvedNow - notInvited + declined + expired,
    pending: n(live?.pending),
    confirmed: n(live?.confirmed),
    declined,
    expired,
    present: n(live?.present),
    notInvited,
  };
}

export type RsvpRow = {
  memberId: number;
  username: string;
  name: string | null;
  email: string;
  state: "nao_convidado" | "pending" | "confirmed" | "declined" | "expired";
  deadlineAt: string | null;
  respondedAt: string | null;
  checkedInAt: string | null;
  reminderStage: number;
  lastMessageAt: string | null;
};

/** aprovados (com estado do RSVP) + quem liberou a vaga — a lista da aba presença */
export async function listRsvpRows(hackathonId: string): Promise<RsvpRow[]> {
  const [live, released] = await Promise.all([
    db
      .prepare(
        `SELECT r.memberId, m.username, m.name, m.email,
                COALESCE(r.rsvpStatus, 'nao_convidado') AS state,
                r.rsvpDeadlineAt AS "deadlineAt", r.rsvpAt AS "respondedAt", c.at AS "checkedInAt",
                r.rsvpReminderStage AS "reminderStage",
                (SELECT MAX(x.createdAt) FROM rsvp_messages x WHERE x.registrationId = r.id) AS "lastMessageAt"
         FROM registrations r
         JOIN members m ON m.id = r.memberId
         LEFT JOIN checkins c ON c.registrationId = r.id
         WHERE r.hackathonId = ? AND r.status = 'approved'
         ORDER BY CASE COALESCE(r.rsvpStatus, 'nao_convidado')
                    WHEN 'pending' THEN 0 WHEN 'nao_convidado' THEN 1 ELSE 2 END,
                  m.username`,
      )
      .all<RsvpRow>(hackathonId),
    db
      .prepare(
        `SELECT x.memberId, m.username, m.name, m.email, x.outcome AS state,
                NULL AS "deadlineAt", x.at AS "respondedAt", NULL AS "checkedInAt",
                0 AS "reminderStage", NULL AS "lastMessageAt"
         FROM rsvp_releases x JOIN members m ON m.id = x.memberId
         WHERE x.hackathonId = ?
         ORDER BY x.at DESC, x.id DESC`,
      )
      .all<RsvpRow>(hackathonId),
  ]);
  return [...live, ...released];
}

export const RSVP_STATE_LABEL: Record<RsvpRow["state"], string> = {
  nao_convidado: "não convidado",
  pending: "aguardando",
  confirmed: "confirmou",
  declined: "recusou",
  expired: "expirou",
};

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // fórmula em planilha (=, +, -, @) vira texto
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function rsvpCsv(rows: RsvpRow[]): string {
  const header = ["username", "nome", "email", "rsvp", "prazo", "respondeu_em", "check_in"];
  const lines = rows.map((r) =>
    [r.username, r.name, r.email, RSVP_STATE_LABEL[r.state], r.deadlineAt, r.respondedAt, r.checkedInAt]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

// ---------- histórico de comparecimento ----------
// Informativo, transparente e contestável (LGPD art. 20): o membro vê o
// mesmo que o organizador, nada vira nota nem decide admissão sozinho.
// Regras:
//  - compareceu = inscrição aprovada com check-in;
//  - faltou = confirmou (ou edição sem RSVP) e não fez check-in, numa
//    edição já encerrada que USOU check-in — edição sem nenhum check-in
//    registrado não entra (não dá pra afirmar falta);
//  - sem_resposta = convidado, não respondeu, não apareceu (vaga não chegou
//    a expirar porque o prazo caiu no início);
//  - recusou / expirou = vaga liberada pelo RSVP (recusar é o comportamento
//    certo — está aqui só pra transparência).

export type AttendanceOutcome = "compareceu" | "faltou" | "sem_resposta" | "recusou" | "expirou";

export const ATTENDANCE_LABEL: Record<AttendanceOutcome, string> = {
  compareceu: "compareceu",
  faltou: "faltou",
  sem_resposta: "não respondeu e não foi",
  recusou: "liberou a vaga",
  expirou: "não confirmou a tempo",
};

export type AttendanceEntry = {
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  outcome: AttendanceOutcome;
};

export type AttendanceSummary = Record<AttendanceOutcome, number> & { total: number };

const emptySummary = (): AttendanceSummary => ({
  compareceu: 0,
  faltou: 0,
  sem_resposta: 0,
  recusou: 0,
  expirou: 0,
  total: 0,
});

type HistoryRow = {
  memberId: number;
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  endsAt: string | null;
  rsvpStatus: RsvpStatus | null;
  checkedIn: boolean;
  editionUsedCheckin: boolean;
  outcome: "declined" | "expired" | null;
};

async function historyRows(memberIds: number[], excludeHackathonId: string | null): Promise<HistoryRow[]> {
  if (memberIds.length === 0) return [];
  const ids = memberIds.join(",");
  if (!/^[\d,]+$/.test(ids)) throw new Error("memberIds inválidos");
  return db
    .prepare(
      `SELECT r.memberId, h.id AS "hackathonId", h.name AS "hackathonName", h.startsAt, h.endsAt,
              r.rsvpStatus, (c.registrationId IS NOT NULL) AS "checkedIn",
              EXISTS (SELECT 1 FROM checkins c2 JOIN registrations r2 ON r2.id = c2.registrationId
                      WHERE r2.hackathonId = h.id) AS "editionUsedCheckin",
              NULL AS outcome
       FROM registrations r
       JOIN hackathons h ON h.id = r.hackathonId
       LEFT JOIN checkins c ON c.registrationId = r.id
       WHERE r.memberId IN (${ids}) AND r.status = 'approved' AND (?::text IS NULL OR h.id <> ?::text)
       UNION ALL
       SELECT x.memberId, h.id, h.name, h.startsAt, h.endsAt, NULL, false, false, x.outcome
       FROM rsvp_releases x JOIN hackathons h ON h.id = x.hackathonId
       WHERE x.memberId IN (${ids}) AND (?::text IS NULL OR h.id <> ?::text)`,
    )
    .all<HistoryRow>(excludeHackathonId, excludeHackathonId, excludeHackathonId, excludeHackathonId);
}

function classify(r: HistoryRow, now: Date): AttendanceOutcome | null {
  if (r.outcome === "declined") return "recusou";
  if (r.outcome === "expired") return "expirou";
  if (r.checkedIn) return "compareceu";
  const start = parseEventStart(r.startsAt);
  const end = parseEventStart(r.endsAt) ?? (start ? new Date(start.getTime() + DAY) : null);
  if (!end || now < end || !r.editionUsedCheckin) return null;
  return r.rsvpStatus === "pending" ? "sem_resposta" : "faltou";
}

export async function getAttendanceHistory(
  memberId: number,
  now = new Date(),
): Promise<{ entries: AttendanceEntry[]; summary: AttendanceSummary }> {
  const rows = await historyRows([memberId], null);
  const entries: AttendanceEntry[] = [];
  const summary = emptySummary();
  for (const r of rows) {
    const outcome = classify(r, now);
    if (!outcome) continue;
    entries.push({ hackathonId: r.hackathonId, hackathonName: r.hackathonName, startsAt: r.startsAt, outcome });
    summary[outcome]++;
    summary.total++;
  }
  entries.sort((a, b) => (parseEventStart(b.startsAt)?.getTime() ?? 0) - (parseEventStart(a.startsAt)?.getTime() ?? 0));
  return { entries, summary };
}

/** resumo por membro pra curadoria (sem a edição que está sendo curada) */
export async function getAttendanceSummaries(
  memberIds: number[],
  excludeHackathonId: string | null,
  now = new Date(),
): Promise<Record<number, AttendanceSummary>> {
  const out: Record<number, AttendanceSummary> = {};
  for (const r of await historyRows(memberIds, excludeHackathonId)) {
    const outcome = classify(r, now);
    if (!outcome) continue;
    const s = (out[r.memberId] ??= emptySummary());
    s[outcome]++;
    s.total++;
  }
  return out;
}

export function summaryText(s: AttendanceSummary | undefined): string {
  if (!s || s.total === 0) return "sem histórico de presença";
  const parts: string[] = [];
  if (s.compareceu) parts.push(`${s.compareceu} compareceu`);
  if (s.faltou) parts.push(`${s.faltou} faltou`);
  if (s.sem_resposta) parts.push(`${s.sem_resposta} sem resposta`);
  if (s.recusou) parts.push(`${s.recusou} liberou vaga`);
  if (s.expirou) parts.push(`${s.expirou} não confirmou`);
  return parts.join(" · ");
}

/** convites do RSVP esperando resposta do membro (cartão no /dashboard) */
export async function listPendingRsvpForMember(
  memberId: number,
  now = new Date(),
): Promise<{ hackathonId: string; hackathonName: string; deadline: string; href: string }[]> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.hackathonId, h.name AS "hackathonName", r.rsvpDeadlineAt
       FROM registrations r JOIN hackathons h ON h.id = r.hackathonId
       WHERE r.memberId = ? AND r.status = 'approved' AND r.rsvpStatus = 'pending'
         AND to_ts(r.rsvpDeadlineAt) > to_ts(?)
       ORDER BY r.rsvpDeadlineAt`,
    )
    .all<{ id: number; hackathonId: string; hackathonName: string; rsvpDeadlineAt: string }>(memberId, sqlTime(now));
  return rows.map((r) => {
    const deadline = fromSqlTime(r.rsvpDeadlineAt);
    return {
      hackathonId: r.hackathonId,
      hackathonName: r.hackathonName,
      deadline: formatDeadline(deadline),
      href: `/rsvp/${rsvpToken(r.id, deadline)}`,
    };
  });
}
