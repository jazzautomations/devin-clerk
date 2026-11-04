import { randomInt } from "node:crypto";
import db from "@/lib/db";
import { AREA_KEYS, areaLabel, areasFromJson, isAreaKey, type AreaKey } from "@/lib/areas";
import { isBlockedEither } from "@/lib/blocks";
import { editionCheckinWindow } from "@/lib/checkins";
import { cardText, isCardKey } from "@/lib/encounterCards";
import { getHackathon } from "@/lib/hackathons";
import {
  encounterCounters,
  grantEncounterBadges,
  missionProgress,
  suggestionsFor,
  type EncounterCounters,
  type MissionProgress,
  type MissionSuggestion,
} from "@/lib/missions";
import { personaLabel } from "@/lib/personas";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";

// Encontros na edição (spec 046, onda 5 — migration 050; desenho da 045).
//
// Leve e opcional, ligado pelo organizador ("encountersOn"). Quem fez
// check-in e aceitou tem um código de 5 caracteres e um QR; ler o código de
// alguém abre um encontro PENDENTE, e ele só vale quando a outra pessoa
// confirma (ou quando ela lê o código de volta). Confirmado, o contato do
// canal escolhido aparece pros dois, cada um diz se foi "papo rápido" ou
// "fomos além do oi" (profundidade só conta se os DOIS marcarem "além") e o
// par pode virar convite de time.
//
// O que este módulo NÃO faz, de propósito:
// - não dá XP (spec 043): encontro alimenta selo e bicho, nunca rep;
// - não usa o QR do ingresso (aquele é a credencial de presença);
// - não guarda contato: lê do perfil na hora, e só depois de confirmado;
// - não mostra nome pra organizador nenhum (só agregado, N < 5 = "poucos dados");
// - não usa GPS nem diz onde a pessoa está.
//
// Anti-abuso: 30 leituras por hora (lib/ratelimit, chave "encounters"), no
// máximo 5 pendentes, um encontro por par por edição, 15 min de validade e
// resposta GENÉRICA ("Código não encontrado.") pra código inválido, de quem
// pausou, de quem bloqueou ou de quem já recusou 3 vezes.

export const CODE_LEN = 5;
/** sem 0, O, 1 e I: quem digita do crachá impresso não confunde */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_RE = /^[2-9A-HJ-NP-Z]{5}$/;
export const PENDING_TTL_MIN = 15;
export const MAX_PENDING = 5;
export const DECLINE_LOCK = 3;
export const NOTE_MAX = 280;
export const GENERIC_CODE_ERROR = "Código não encontrado.";

export const CONTACT_CHANNELS = ["linkedin", "github", "email"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_CHANNEL_LABEL: Record<ContactChannel, string> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  email: "e-mail",
};

export const isContactChannel = (v: unknown): v is ContactChannel =>
  typeof v === "string" && (CONTACT_CHANNELS as readonly string[]).includes(v);

export type EncounterStatus = "pending" | "confirmed" | "declined" | "expired";
export type EncounterDepth = "rapido" | "alem";
export const DEPTH_LABEL: Record<EncounterDepth, string> = {
  rapido: "papo rápido",
  alem: "fomos além do oi",
};

/** motivos de falha ao ler um código (a maioria devolve a mesma resposta) */
export type ReadCodeErrorKind = "not_found" | "own" | "pending" | "already" | "limit" | "gate";

export function isEncounterDepth(v: unknown): v is EncounterDepth {
  return v === "rapido" || v === "alem";
}

/** aceita "abcde", "abc de" e a URL do QR (/h/x/encontros?c=ABCDE) */
export function normalizeMeetCode(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const fromUrl = /[?&]c=([^&#\s]+)/.exec(s);
  const base = fromUrl ? decodeURIComponent(fromUrl[1]) : s;
  return base.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function isMeetCode(v: unknown): v is string {
  return typeof v === "string" && CODE_RE.test(v);
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

// ---------- portas e mensagens ----------

export type GateReason = "edition" | "off" | "registration" | "checkin" | "age" | "consent" | "window";

export const GATE_MESSAGE: Record<GateReason, string> = {
  edition: "Os encontros só existem numa edição publicada.",
  off: "Os encontros não estão ligados nesta edição. Quem organiza liga no painel da edição.",
  registration: "Os encontros são de quem está inscrito e aprovado nesta edição.",
  checkin: "Falta o check-in: os encontros valem pra quem está no evento.",
  age: "Os encontros são 18+. Confira os dados da sua conta.",
  consent: "Falta o seu aceite de encontros nesta edição. Ele mostra o que a outra pessoa vai ver.",
  window: "Os encontros valem durante a edição: da véspera até dois dias depois do fim.",
};

export type Gate = { ok: true; windowOpen: boolean } | { ok: false; reason: GateReason; message: string };

export class EncounterError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind = "error",
  ) {
    super(message);
  }
}

// ---------- cartão da pessoa ----------

export type PersonCard = {
  memberId: number;
  username: string;
  name: string | null;
  /** primeiro nome (ou @), pro cartão e pras frases fixas */
  firstName: string;
  avatarUrl: string | null;
  personas: string[];
  skills: string[];
  city: string | null;
  institution: string | null;
  /** o que o anúncio de time da pessoa procura (aparece no cartão) */
  need: string | null;
  /** só depois de confirmado: o canal escolhido por ela, lido do perfil */
  contact: { channel: ContactChannel; label: string; value: string } | null;
};

export function firstNameOf(name: string | null, username: string): string {
  const clean = (name ?? "").trim();
  if (!clean) return `@${username}`;
  return clean.split(/\s+/)[0];
}

function personaKeys(raw: string | null): string[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function personaLabels(raw: string | null): string[] {
  return personaKeys(raw).map((k) => personaLabel(k)).filter((x): x is string => !!x);
}

/** personas ∩ AREA_KEYS, na ordem de AREA_KEYS (o selo de complemento usa isso) */
export function areasFromPersonas(raw: string | null): AreaKey[] {
  const keys = personaKeys(raw);
  return AREA_KEYS.filter((k) => keys.includes(k));
}

function skillList(raw: string | null): string[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? list.map(String).filter(Boolean).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function contactOf(
  channel: string | null,
  row: { linkedin: string | null; github: string | null; email: string | null },
): PersonCard["contact"] {
  if (!isContactChannel(channel)) return null;
  const value = row[channel];
  if (!value) return null;
  return { channel, label: CONTACT_CHANNEL_LABEL[channel], value };
}

// ---------- selo de complemento (frase fixa, sem IA) ----------

/**
 * "você é desenvolvimento, Ana é design; seu time procura design" — só sai
 * quando as áreas são diferentes E a vaga aberta do meu time é a área dela.
 * Fixa de propósito: nada de IA escrevendo sobre pessoa (spec 046, não fazer).
 */
export function complementoPhrase(input: {
  myAreas: AreaKey[];
  peerAreas: AreaKey[];
  peerFirstName: string;
  openingArea: AreaKey | null;
}): string | null {
  const mine = input.myAreas[0];
  const theirs = input.peerAreas[0];
  if (!mine || !theirs || mine === theirs) return null;
  if (!input.openingArea || input.openingArea !== theirs) return null;
  const a = areaLabel(mine);
  const b = areaLabel(theirs);
  if (!a || !b) return null;
  return `você é ${a}, ${input.peerFirstName} é ${b}; seu time procura ${b}`;
}

// ---------- meu código e meus aceites ----------

export type MyMeet = {
  code: string;
  channel: ContactChannel;
  paused: boolean;
  newcomerOptIn: boolean;
  introOptIn: boolean;
  optedInAt: string;
};

type MyMeetRow = {
  code: string;
  contactChannel: string;
  pausedAt: string | null;
  newcomerOptIn: number;
  introOptIn: number;
  optedInAt: string;
};

const toMyMeet = (r: MyMeetRow): MyMeet => ({
  code: r.code,
  channel: isContactChannel(r.contactChannel) ? r.contactChannel : "linkedin",
  paused: !!r.pausedAt,
  newcomerOptIn: !!Number(r.newcomerOptIn),
  introOptIn: !!Number(r.introOptIn),
  optedInAt: r.optedInAt,
});

export async function myMeet(memberId: number, hackathonId: string): Promise<MyMeet | null> {
  const row = await db
    .prepare(
      `SELECT code, "contactChannel", "pausedAt", "newcomerOptIn", "introOptIn", "optedInAt"
       FROM edition_meet_codes WHERE "hackathonId" = ? AND "memberId" = ?`,
    )
    .get<MyMeetRow>(hackathonId, memberId);
  return row ? toMyMeet(row) : null;
}

/** aceite de encontros na edição: cria o código (idempotente) */
export async function optInEncounters(
  memberId: number,
  hackathonId: string,
  input: { channel?: unknown; newcomerOptIn?: unknown; introOptIn?: unknown } = {},
): Promise<MyMeet> {
  const current = await myMeet(memberId, hackathonId);
  const channel = isContactChannel(input.channel)
    ? input.channel
    : (current?.channel ?? "linkedin");
  const newcomer = input.newcomerOptIn === undefined ? (current?.newcomerOptIn ?? false) : input.newcomerOptIn === true;
  const intro = input.introOptIn === undefined ? (current?.introOptIn ?? false) : input.introOptIn === true;
  if (current) {
    await db
      .prepare(
        `UPDATE edition_meet_codes
         SET "contactChannel" = ?, "newcomerOptIn" = ?, "introOptIn" = ?, "pausedAt" = NULL
         WHERE "hackathonId" = ? AND "memberId" = ?`,
      )
      .run(channel, newcomer ? 1 : 0, intro ? 1 : 0, hackathonId, memberId);
    return (await myMeet(memberId, hackathonId))!;
  }
  // código novo: 8 tentativas cobrem colisão num alfabeto de 32^5
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO edition_meet_codes
           ("hackathonId", "memberId", code, "contactChannel", "newcomerOptIn", "introOptIn")
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(hackathonId, memberId, code, channel, newcomer ? 1 : 0, intro ? 1 : 0);
    if (res.changes > 0) return (await myMeet(memberId, hackathonId))!;
    const mine = await myMeet(memberId, hackathonId);
    if (mine) return mine;
  }
  throw new EncounterError("Não consegui gerar seu código agora. Tente de novo.", 503);
}

/** pausar esconde o código de todo mundo (mesma resposta genérica de "não achei") */
export async function pauseEncounters(memberId: number, hackathonId: string, paused: boolean): Promise<MyMeet> {
  const res = await db
    .prepare(
      `UPDATE edition_meet_codes SET "pausedAt" = ${paused ? "sqlite_now()" : "NULL"}
       WHERE "hackathonId" = ? AND "memberId" = ?`,
    )
    .run(hackathonId, memberId);
  if (res.changes === 0) throw new EncounterError(GATE_MESSAGE.consent, 403);
  return (await myMeet(memberId, hackathonId))!;
}

/** regenerar invalida o código antigo (o QR velho deixa de funcionar) */
export async function rotateMeetCode(memberId: number, hackathonId: string): Promise<MyMeet> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const res = await db
      .prepare(
        `UPDATE edition_meet_codes SET code = ?
         WHERE "hackathonId" = ? AND "memberId" = ?
           AND NOT EXISTS (SELECT 1 FROM edition_meet_codes o
                           WHERE o."hackathonId" = ? AND o.code = ?)`,
      )
      .run(code, hackathonId, memberId, hackathonId, code);
    if (res.changes > 0) return (await myMeet(memberId, hackathonId))!;
  }
  throw new EncounterError("Não consegui gerar um código novo agora. Tente de novo.", 503);
}

/** revogar o aceite: apaga o código e o que ele permitia */
export async function revokeEncounters(memberId: number, hackathonId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM edition_meet_codes WHERE "hackathonId" = ? AND "memberId" = ?`)
    .run(hackathonId, memberId);
}

// ---------- portas ----------

async function baseGate(memberId: number, hackathonId: string, now: Date): Promise<Gate> {
  const h = await db
    .prepare(`SELECT active, "encountersOn", startsAt, endsAt FROM hackathons WHERE id = ?`)
    .get<{ active: number; encountersOn: number; startsAt: string; endsAt: string | null }>(hackathonId);
  if (!h || !Number(h.active)) return { ok: false, reason: "edition", message: GATE_MESSAGE.edition };
  if (!Number(h.encountersOn)) return { ok: false, reason: "off", message: GATE_MESSAGE.off };
  const reg = await db
    .prepare(
      `SELECT r.status, c.at AS "checkinAt"
       FROM registrations r LEFT JOIN checkins c ON c."registrationId" = r.id
       WHERE r."memberId" = ? AND r."hackathonId" = ?`,
    )
    .get<{ status: string; checkinAt: string | null }>(memberId, hackathonId);
  if (!reg || reg.status !== "approved") return { ok: false, reason: "registration", message: GATE_MESSAGE.registration };
  if (!reg.checkinAt) return { ok: false, reason: "checkin", message: GATE_MESSAGE.checkin };
  if (!(await canNetwork(memberId, hackathonId))) return { ok: false, reason: "age", message: GATE_MESSAGE.age };
  const win = await editionCheckinWindow(hackathonId, now);
  const windowOpen = !!win && win.inside;
  return { ok: true, windowOpen };
}

/** portas do encontro: edição, inscrição aprovada, check-in, 18+ e aceite */
export async function encounterGate(memberId: number, hackathonId: string, now = new Date()): Promise<Gate> {
  const base = await baseGate(memberId, hackathonId, now);
  if (!base.ok) return base;
  if (!(await myMeet(memberId, hackathonId))) return { ok: false, reason: "consent", message: GATE_MESSAGE.consent };
  return base;
}

// ---------- encontros ----------

export type EncounterView = {
  id: number;
  hackathonId: string;
  hackathonName?: string;
  status: EncounterStatus;
  peer: PersonCard;
  createdAt: string;
  confirmedAt: string | null;
  /** expira em (pending): ISO */
  expiresAt: string | null;
  /** eu pedi? (o pedido pendente do outro lado mostra "fulano quer registrar") */
  mineRequest: boolean;
  side: { depth: EncounterDepth | null; cardKey: string | null; cardText: string | null; note: string | null };
  theirDepth: EncounterDepth | null;
  /** profundidade de verdade: os dois marcaram "além do oi" */
  deep: boolean;
  complemento: string | null;
  /** os dois marcaram "bora fazer junto" */
  teamUp: boolean;
  /** eu já marquei "bora fazer junto" */
  myTeamUp: boolean;
};

type EncounterRow = {
  id: number;
  hackathonId: string;
  hackathonName: string | null;
  status: EncounterStatus;
  createdAt: string;
  confirmedAt: string | null;
  initiatorId: number;
  peerId: number;
  peerUsername: string;
  peerName: string | null;
  peerAvatar: string | null;
  peerPersonas: string | null;
  peerSkills: string | null;
  peerCity: string | null;
  peerInstitution: string | null;
  peerLinkedin: string | null;
  peerGithub: string | null;
  peerEmail: string | null;
  peerNeed: string | null;
  peerChannel: string | null;
  cardKey: string | null;
  depth: string | null;
  note: string | null;
  theirDepth: string | null;
  mySignaled: boolean;
  theirSignaled: boolean;
};

const ENCOUNTER_SELECT = `SELECT e.id, e."hackathonId", h.name AS "hackathonName", e.status,
    e."createdAt", e."confirmedAt", e."initiatorId",
    m.id AS "peerId", m.username AS "peerUsername", m.name AS "peerName", m.avatarUrl AS "peerAvatar",
    m.personas AS "peerPersonas", m.skills AS "peerSkills", m.city AS "peerCity",
    m.institution AS "peerInstitution", m.linkedin AS "peerLinkedin", m.github AS "peerGithub",
    m.email AS "peerEmail",
    l.need AS "peerNeed", mc."contactChannel" AS "peerChannel",
    s."cardKey", s.depth, s.note, sp.depth AS "theirDepth",
    EXISTS (SELECT 1 FROM team_up_signals t
            WHERE t."hackathonId" = e."hackathonId" AND t."memberId" = @me AND t."peerId" = m.id) AS "mySignaled",
    EXISTS (SELECT 1 FROM team_up_signals t
            WHERE t."hackathonId" = e."hackathonId" AND t."memberId" = m.id AND t."peerId" = @me) AS "theirSignaled"
  FROM encounters e
  JOIN hackathons h ON h.id = e."hackathonId"
  JOIN members m ON m.id = CASE WHEN e."lowId" = @me THEN e."highId" ELSE e."lowId" END
  LEFT JOIN looking_for_team l ON l."memberId" = m.id AND l."hackathonId" = e."hackathonId" AND l.active = 1
  LEFT JOIN edition_meet_codes mc ON mc."memberId" = m.id AND mc."hackathonId" = e."hackathonId"
  LEFT JOIN encounter_sides s ON s."encounterId" = e.id AND s."memberId" = @me
  LEFT JOIN encounter_sides sp ON sp."encounterId" = e.id AND sp."memberId" = m.id`;

function toView(r: EncounterRow, myAreas: AreaKey[], openingArea: AreaKey | null): EncounterView {
  const peerFirst = firstNameOf(r.peerName, r.peerUsername);
  const depth = isEncounterDepth(r.depth) ? r.depth : null;
  const theirDepth = isEncounterDepth(r.theirDepth) ? r.theirDepth : null;
  const confirmed = r.status === "confirmed";
  const createdAtMs = new Date(`${r.createdAt.replace(" ", "T")}Z`).getTime();
  return {
    id: r.id,
    hackathonId: r.hackathonId,
    ...(r.hackathonName ? { hackathonName: r.hackathonName } : {}),
    status: r.status,
    peer: {
      memberId: r.peerId,
      username: r.peerUsername,
      name: r.peerName,
      firstName: peerFirst,
      avatarUrl: r.peerAvatar,
      personas: personaLabels(r.peerPersonas),
      skills: skillList(r.peerSkills),
      city: r.peerCity,
      institution: r.peerInstitution,
      need: r.peerNeed,
      // contato só existe depois de confirmado
      contact: confirmed
        ? contactOf(r.peerChannel, { linkedin: r.peerLinkedin, github: r.peerGithub, email: r.peerEmail })
        : null,
    },
    createdAt: r.createdAt,
    confirmedAt: r.confirmedAt,
    expiresAt:
      r.status === "pending" && !Number.isNaN(createdAtMs)
        ? new Date(createdAtMs + PENDING_TTL_MIN * 60_000).toISOString()
        : null,
    mineRequest: false,
    side: {
      depth,
      cardKey: r.cardKey,
      cardText: cardText(r.cardKey),
      note: r.note,
    },
    theirDepth,
    deep: confirmed && depth === "alem" && theirDepth === "alem",
    complemento: complementoPhrase({
      myAreas,
      peerAreas: areasFromPersonas(r.peerPersonas),
      peerFirstName: peerFirst,
      openingArea,
    }),
    teamUp: !!r.mySignaled && !!r.theirSignaled,
    myTeamUp: !!r.mySignaled,
  };
}

async function myAreas(memberId: number): Promise<AreaKey[]> {
  const row = await db
    .prepare(`SELECT personas, "helpOffer" FROM members WHERE id = ?`)
    .get<{ personas: string | null; helpOffer: string | null }>(memberId);
  const fromPersonas = areasFromPersonas(row?.personas ?? null);
  if (fromPersonas.length) return fromPersonas;
  return areasFromJson(row?.helpOffer ?? null);
}

async function myOpeningArea(username: string, hackathonId: string): Promise<AreaKey | null> {
  if (!hackathonId) return null;
  const row = await db
    .prepare(
      `SELECT o.area FROM team_openings o
       JOIN team_members tm ON tm."teamId" = o."teamId"
       WHERE tm.username = ? AND o."hackathonId" = ? AND o.status = 'aberta'
       ORDER BY o."createdAt" DESC LIMIT 1`,
    )
    .get<{ area: string }>(username, hackathonId);
  return isAreaKey(row?.area) ? row.area : null;
}

/** pendente vencido vira expirado (roda em toda leitura da tela) */
export async function expirePending(hackathonId: string, now = new Date()): Promise<number> {
  const cutoff = sqlTime(new Date(now.getTime() - PENDING_TTL_MIN * 60_000));
  const res = await db
    .prepare(
      `UPDATE encounters SET status = 'expired'
       WHERE "hackathonId" = ? AND status = 'pending' AND to_ts("createdAt") <= to_ts(?)`,
    )
    .run(hackathonId, cutoff);
  return res.changes;
}

async function loadViews(
  where: string,
  params: Record<string, unknown>,
  viewer: { memberId: number; username: string },
): Promise<EncounterView[]> {
  const rows = await db
    .prepare(`${ENCOUNTER_SELECT} WHERE ${where}`)
    .all<EncounterRow>({ me: viewer.memberId, ...params });
  if (rows.length === 0) return [];
  const [areas, openings] = await Promise.all([
    myAreas(viewer.memberId),
    Promise.all(
      [...new Set(rows.map((r) => r.hackathonId))].map(
        async (h) => [h, await myOpeningArea(viewer.username, h)] as const,
      ),
    ),
  ]);
  const openingByEdition = new Map(openings);
  return rows.map((r) => ({
    ...toView(r, areas, openingByEdition.get(r.hackathonId) ?? null),
    mineRequest: r.initiatorId === viewer.memberId,
  }));
}

export async function getEncounter(
  memberId: number,
  username: string,
  encounterId: number,
): Promise<EncounterView | null> {
  const rows = await loadViews(
    `e.id = @id AND (e."lowId" = @me OR e."highId" = @me)`,
    { id: encounterId, h: "" },
    { memberId, username },
  );
  return rows[0] ?? null;
}

/** encontros de uma edição (pendentes dos dois lados + confirmados) */
export async function listEncounters(
  memberId: number,
  username: string,
  hackathonId: string,
  now = new Date(),
): Promise<EncounterView[]> {
  await expirePending(hackathonId, now);
  return loadViews(
    `e."hackathonId" = @h AND (e."lowId" = @me OR e."highId" = @me)
       AND e.status IN ('pending', 'confirmed') AND s."hiddenAt" IS NULL`,
    { h: hackathonId },
    { memberId, username },
  );
}

/** "quem eu conheci" (privado): confirmados de todas as edições, mais novo primeiro */
export async function listConnections(memberId: number, username: string): Promise<EncounterView[]> {
  return loadViews(
    `e.status = 'confirmed' AND (e."lowId" = @me OR e."highId" = @me) AND s."hiddenAt" IS NULL
     ORDER BY e."confirmedAt" DESC, e.id DESC`,
    { h: "" },
    { memberId, username },
  );
}

export type ReadCodeResult =
  | { ok: true; encounterId: number; status: "pending" | "confirmed"; peer: PersonCard }
  | { ok: false; kind: ReadCodeErrorKind; message: string };

/**
 * Leu o código de alguém. Código inválido, de quem pausou, de quem bloqueou
 * ou de quem já recusou 3 vezes dá a MESMA resposta. Ler o código de quem já
 * pediu o encontro CONFIRMA (o QR dos dois lados vale como aceite).
 */
export async function readMeetCode(
  member: { id: number; username: string },
  hackathonId: string,
  rawCode: unknown,
  now = new Date(),
): Promise<ReadCodeResult> {
  const gate = await encounterGate(member.id, hackathonId, now);
  if (!gate.ok) return { ok: false, kind: "gate", message: gate.message };
  if (!gate.windowOpen) return { ok: false, kind: "gate", message: GATE_MESSAGE.window };
  const code = normalizeMeetCode(rawCode);
  if (!isMeetCode(code)) return { ok: false, kind: "not_found", message: GENERIC_CODE_ERROR };

  const target = await db
    .prepare(
      `SELECT mc."memberId", mc."pausedAt", m.username, m.name
       FROM edition_meet_codes mc
       JOIN members m ON m.id = mc."memberId"
       JOIN registrations r ON r."memberId" = mc."memberId" AND r."hackathonId" = mc."hackathonId" AND r.status = 'approved'
       JOIN checkins c ON c."registrationId" = r.id
       WHERE mc."hackathonId" = ? AND mc.code = ?`,
    )
    .get<{ memberId: number; pausedAt: string | null; username: string; name: string | null }>(hackathonId, code);
  if (!target || target.pausedAt) return { ok: false, kind: "not_found", message: GENERIC_CODE_ERROR };
  if (target.memberId === member.id) {
    return { ok: false, kind: "own", message: "Esse é o seu código. Leia o de outra pessoa." };
  }
  if (await isBlockedEither(member.id, target.memberId)) {
    return { ok: false, kind: "not_found", message: GENERIC_CODE_ERROR };
  }
  if (!(await canNetwork(target.memberId, hackathonId))) {
    return { ok: false, kind: "not_found", message: GENERIC_CODE_ERROR };
  }
  // 3 recusas pro mesmo alvo travam o par na edição (quem pediu não fica sabendo)
  const decline = await db
    .prepare(
      `SELECT count FROM encounter_declines
       WHERE "hackathonId" = ? AND "memberId" = ? AND "peerId" = ?`,
    )
    .get<{ count: number }>(hackathonId, target.memberId, member.id);
  if (Number(decline?.count ?? 0) >= DECLINE_LOCK) {
    return { ok: false, kind: "not_found", message: GENERIC_CODE_ERROR };
  }

  const [low, high] = member.id < target.memberId ? [member.id, target.memberId] : [target.memberId, member.id];
  const existing = await db
    .prepare(
      `SELECT id, status, "initiatorId" FROM encounters
       WHERE "hackathonId" = ? AND "lowId" = ? AND "highId" = ?`,
    )
    .get<{ id: number; status: EncounterStatus; initiatorId: number }>(hackathonId, low, high);

  const peerCard = await personCard(target.memberId, hackathonId, false);

  if (existing) {
    if (existing.status === "confirmed") {
      return {
        ok: false,
        kind: "already",
        message: "Vocês já têm um encontro registrado nesta edição.",
      };
    }
    if (existing.status === "pending") {
      if (existing.initiatorId !== member.id) {
        // leu o QR de quem pediu: confirma
        await db
          .prepare(
            `UPDATE encounters SET status = 'confirmed', "confirmedAt" = sqlite_now() WHERE id = ?`,
          )
          .run(existing.id);
        await grantEncounterBadges(member.id);
        await grantEncounterBadges(existing.initiatorId);
        await notify(existing.initiatorId, {
          type: "encontro",
          actorId: member.id,
          actorUsername: member.username,
          text: `@${member.username} confirmou o encontro com você`,
          href: `/h/${hackathonId}/encontros`,
        });
        return { ok: true, encounterId: existing.id, status: "confirmed", peer: peerCard };
      }
      return {
        ok: false,
        kind: "pending",
        message: "Você já pediu esse encontro. Falta a confirmação da outra pessoa.",
      };
    }
    // recusado ou expirado antes: o par pode tentar de novo (3 recusas travam)
  } else {
    const pend = await db
      .prepare(
        `SELECT COUNT(*)::int AS n FROM encounters
         WHERE "hackathonId" = @h AND status = 'pending' AND ("lowId" = @me OR "highId" = @me)`,
      )
      .get<{ n: number }>({ h: hackathonId, me: member.id });
    if (Number(pend?.n ?? 0) >= MAX_PENDING) {
      return {
        ok: false,
        kind: "limit",
        message: `Você tem ${MAX_PENDING} encontros esperando confirmação. Resolva um deles antes de pedir outro.`,
      };
    }
  }

  let encounterId: number;
  if (existing) {
    await db
      .prepare(
        `UPDATE encounters SET status = 'pending', "initiatorId" = ?, "createdAt" = sqlite_now(), "confirmedAt" = NULL
         WHERE id = ?`,
      )
      .run(member.id, existing.id);
    encounterId = existing.id;
  } else {
    const row = await db
      .prepare(
        `INSERT INTO encounters ("hackathonId", "lowId", "highId", "initiatorId", status)
         VALUES (?, ?, ?, ?, 'pending') RETURNING id`,
      )
      .get<{ id: number }>(hackathonId, low, high, member.id);
    encounterId = row!.id;
  }
  await notify(target.memberId, {
    type: "encontro",
    actorId: member.id,
    actorUsername: member.username,
    text: `@${member.username} quer registrar o encontro`,
    href: `/h/${hackathonId}/encontros`,
  });
  return { ok: true, encounterId, status: "pending", peer: peerCard };
}

/** cartão de uma pessoa da edição (contato só quando confirmado) */
export async function personCard(
  memberId: number,
  hackathonId: string,
  withContact: boolean,
): Promise<PersonCard> {
  const row = await db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.personas, m.skills, m.city, m.institution,
              m.linkedin, m.github, m.email,
              (SELECT l.need FROM looking_for_team l
                WHERE l."memberId" = m.id AND l."hackathonId" = ? AND l.active = 1) AS need,
              (SELECT mc."contactChannel" FROM edition_meet_codes mc
                WHERE mc."memberId" = m.id AND mc."hackathonId" = ?) AS channel
       FROM members m WHERE m.id = ?`,
    )
    .get<{
      id: number;
      username: string;
      name: string | null;
      avatarUrl: string | null;
      personas: string | null;
      skills: string | null;
      city: string | null;
      institution: string | null;
      linkedin: string | null;
      github: string | null;
      email: string | null;
      need: string | null;
      channel: string | null;
    }>(hackathonId, hackathonId, memberId);
  if (!row) throw new EncounterError("Pessoa não encontrada.", 404);
  return {
    memberId: row.id,
    username: row.username,
    name: row.name,
    firstName: firstNameOf(row.name, row.username),
    avatarUrl: row.avatarUrl,
    personas: personaLabels(row.personas),
    skills: skillList(row.skills),
    city: row.city,
    institution: row.institution,
    need: row.need,
    contact: withContact ? contactOf(row.channel, row) : null,
  };
}

async function encounterFor(memberId: number, encounterId: number) {
  const row = await db
    .prepare(
      `SELECT id, "hackathonId", "lowId", "highId", "initiatorId", status, "createdAt"
       FROM encounters WHERE id = ? AND ("lowId" = ? OR "highId" = ?)`,
    )
    .get<{
      id: number;
      hackathonId: string;
      lowId: number;
      highId: number;
      initiatorId: number;
      status: EncounterStatus;
      createdAt: string;
    }>(encounterId, memberId, memberId);
  return row ?? null;
}

export type RespondAction = "confirm" | "decline";

/** confirma ou recusa um pedido. Recusa NÃO avisa quem pediu. */
export async function respondEncounter(
  member: { id: number; username: string },
  encounterId: number,
  action: RespondAction,
  now = new Date(),
): Promise<EncounterView> {
  const e = await encounterFor(member.id, encounterId);
  if (!e) throw new EncounterError("Encontro não encontrado.", 404);
  if (e.status !== "pending") {
    throw new EncounterError(
      e.status === "confirmed" ? "Esse encontro já está confirmado." : "Esse pedido não está mais aberto.",
      409,
    );
  }
  const created = new Date(`${e.createdAt.replace(" ", "T")}Z`).getTime();
  if (!Number.isNaN(created) && now.getTime() - created > PENDING_TTL_MIN * 60_000) {
    await db.prepare(`UPDATE encounters SET status = 'expired' WHERE id = ?`).run(e.id);
    throw new EncounterError("Esse pedido expirou. Leia o código de novo.", 409);
  }
  const peerId = e.lowId === member.id ? e.highId : e.lowId;
  if (action === "confirm") {
    if (e.initiatorId === member.id) {
      throw new EncounterError("Quem pediu não confirma: espere a outra pessoa.", 403);
    }
    await db
      .prepare(`UPDATE encounters SET status = 'confirmed', "confirmedAt" = sqlite_now() WHERE id = ?`)
      .run(e.id);
    await grantEncounterBadges(member.id);
    await grantEncounterBadges(e.initiatorId);
    await notify(e.initiatorId, {
      type: "encontro",
      actorId: member.id,
      actorUsername: member.username,
      text: `@${member.username} confirmou o encontro com você`,
      href: `/h/${e.hackathonId}/encontros`,
    });
  } else {
    await db.prepare(`UPDATE encounters SET status = 'declined' WHERE id = ?`).run(e.id);
    // cancelar o próprio pedido não conta como recusa contra a outra pessoa
    if (e.initiatorId !== member.id) {
      await db
        .prepare(
          `INSERT INTO encounter_declines ("hackathonId", "memberId", "peerId", count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT ("hackathonId", "memberId", "peerId")
           DO UPDATE SET count = encounter_declines.count + 1`,
        )
        .run(e.hackathonId, member.id, peerId);
    }
  }
  const view = await getEncounter(member.id, member.username, e.id);
  if (!view) throw new EncounterError("Encontro não encontrado.", 404);
  return view;
}

export type SideInput = { depth?: unknown; cardKey?: unknown; note?: unknown; hide?: unknown };

/** "como foi a conversa": profundidade, carta usada e nota privada (só depois de confirmado) */
export async function setEncounterSide(
  member: { id: number; username: string },
  encounterId: number,
  input: SideInput,
): Promise<EncounterView> {
  const e = await encounterFor(member.id, encounterId);
  if (!e) throw new EncounterError("Encontro não encontrado.", 404);
  if (e.status !== "confirmed") throw new EncounterError("Isso vale depois que o encontro é confirmado.", 409);

  if (input.hide === true) {
    await db
      .prepare(
        `INSERT INTO encounter_sides ("encounterId", "memberId", "hiddenAt") VALUES (?, ?, sqlite_now())
         ON CONFLICT ("encounterId", "memberId") DO UPDATE SET "hiddenAt" = sqlite_now()`,
      )
      .run(e.id, member.id);
    const hidden = await getEncounter(member.id, member.username, e.id);
    if (!hidden) throw new EncounterError("Encontro não encontrado.", 404);
    return hidden;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.depth !== undefined) {
    if (input.depth !== null && !isEncounterDepth(input.depth)) {
      throw new EncounterError("Escolha papo rápido ou fomos além do oi.", 400);
    }
    sets.push(`depth = ?`);
    params.push(input.depth === null ? null : input.depth);
  }
  if (input.cardKey !== undefined) {
    if (input.cardKey !== null && !isCardKey(input.cardKey)) throw new EncounterError("Carta desconhecida.", 400);
    sets.push(`"cardKey" = ?`);
    params.push(input.cardKey === null ? null : input.cardKey);
  }
  if (input.note !== undefined) {
    const note = input.note === null ? "" : String(input.note).trim();
    if (note.length > NOTE_MAX) throw new EncounterError(`A nota é sua e tem até ${NOTE_MAX} caracteres.`, 400);
    sets.push(`note = ?`);
    params.push(note || null);
  }
  if (sets.length === 0) throw new EncounterError("Nada pra salvar.", 400);

  await db
    .prepare(
      `INSERT INTO encounter_sides ("encounterId", "memberId") VALUES (?, ?)
       ON CONFLICT ("encounterId", "memberId") DO NOTHING`,
    )
    .run(e.id, member.id);
  await db
    .prepare(`UPDATE encounter_sides SET ${sets.join(", ")} WHERE "encounterId" = ? AND "memberId" = ?`)
    .run(...params, e.id, member.id);
  const view = await getEncounter(member.id, member.username, e.id);
  if (!view) throw new EncounterError("Encontro não encontrado.", 404);
  return view;
}

// ---------- ponte (apresentei X a Y) ----------

export async function createIntroduction(
  member: { id: number; username: string },
  hackathonId: string,
  peerUsername: unknown,
  recipientUsername: unknown,
): Promise<{ id: number }> {
  const norm = (v: unknown) => String(v ?? "").trim().replace(/^@/, "").toLowerCase();
  const peer = norm(peerUsername);
  const recipient = norm(recipientUsername);
  if (!peer || !recipient || peer === recipient) {
    throw new EncounterError("Escolha duas pessoas diferentes.", 400);
  }
  const gate = await encounterGate(member.id, hackathonId);
  if (!gate.ok) throw new EncounterError(gate.message, 403);
  const rows = await db
    .prepare(
      `SELECT m.id, m.username FROM members m
       JOIN registrations r ON r."memberId" = m.id AND r."hackathonId" = ? AND r.status = 'approved'
       WHERE m.username = ANY(?::text[])`,
    )
    .all<{ id: number; username: string }>(hackathonId, [peer, recipient]);
  if (rows.length < 2) throw new EncounterError("As duas pessoas precisam estar inscritas nesta edição.", 400);
  const [a, b] = rows;
  if (a.id === member.id || b.id === member.id) throw new EncounterError("Escolha duas pessoas.", 400);
  if ((await isBlockedEither(member.id, a.id)) || (await isBlockedEither(member.id, b.id))) {
    throw new EncounterError("Não deu pra apresentar essas pessoas agora.", 400);
  }
  const row = await db
    .prepare(
      `INSERT OR IGNORE INTO introductions ("hackathonId", "memberId", "peerId", "recipientId")
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(hackathonId, member.id, a.id, b.id);
  if (!row) throw new EncounterError("Você já apresentou essas duas pessoas nesta edição.", 409);
  await Promise.all(
    [a.id, b.id].map((id) =>
      notify(id, {
        type: "encontro",
        actorId: member.id,
        actorUsername: member.username,
        text: `@${member.username} apresentou você a @${id === a.id ? b.username : a.username}`,
        href: `/h/${hackathonId}/encontros`,
      }),
    ),
  );
  return { id: row.id };
}

// ---------- "procure no evento" ----------

export type Suggestion = {
  mission: string;
  missionLabel: string;
  people: { username: string; firstName: string; avatarUrl: string | null }[];
};

// ---------- organizador: só agregado ----------

export type AdminEncounterStats = {
  presentes: number;
  comEncontro: number;
  /** 0–1 */
  pctComEncontro: number;
  entreFaculdades: number;
  timesFormados: number;
  distribuicao: { zero: number; um: number; doisTres: number; quatroMais: number };
  /** N < 5 vira "poucos dados" na tela */
  poucosDados: boolean;
  encontros: number;
  confirmados: number;
};

export async function adminEncounterStats(hackathonId: string): Promise<AdminEncounterStats> {
  const presentesRow = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM registrations r
       JOIN checkins c ON c."registrationId" = r.id
       WHERE r."hackathonId" = ? AND r.status = 'approved'`,
    )
    .get<{ n: number }>(hackathonId);
  const presentes = Number(presentesRow?.n ?? 0);
  const porPessoa = await db
    .prepare(
      `SELECT m AS "memberId", COUNT(*)::int AS n FROM (
         SELECT e."lowId" AS m FROM encounters e
          WHERE e."hackathonId" = @h AND e.status = 'confirmed'
         UNION ALL
         SELECT e."highId" AS m FROM encounters e
          WHERE e."hackathonId" = @h AND e.status = 'confirmed'
       ) x GROUP BY m`,
    )
    .all<{ memberId: number; n: number }>({ h: hackathonId });
  const comEncontro = porPessoa.length;
  const dist = { zero: 0, um: 0, doisTres: 0, quatroMais: 0 };
  for (const r of porPessoa) {
    const n = Number(r.n);
    if (n <= 0) dist.zero += 1;
    else if (n === 1) dist.um += 1;
    else if (n <= 3) dist.doisTres += 1;
    else dist.quatroMais += 1;
  }
  dist.zero = Math.max(0, presentes - comEncontro);

  const faculdades = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM encounters e
       JOIN members a ON a.id = e."lowId"
       JOIN members b ON b.id = e."highId"
       WHERE e."hackathonId" = ? AND e.status = 'confirmed'
         AND ((COALESCE(a.institution, '') <> '' AND COALESCE(b.institution, '') <> ''
               AND a.institution <> b.institution)
           OR (COALESCE(a.city, '') <> '' AND COALESCE(b.city, '') <> '' AND a.city <> b.city))`,
    )
    .get<{ n: number }>(hackathonId);
  const times = await db
    .prepare(
      `SELECT COUNT(DISTINCT t.id)::int AS n
       FROM teams t
       JOIN team_members tm ON tm."teamId" = t.id
       JOIN members m ON m.username = tm.username
       JOIN encounters e ON e."hackathonId" = t."hackathonId" AND e.status = 'confirmed'
         AND (e."lowId" = m.id OR e."highId" = m.id)
       WHERE t."hackathonId" = ?
         AND EXISTS (
           SELECT 1 FROM team_members tm2 JOIN members m2 ON m2.username = tm2.username
           WHERE tm2."teamId" = t.id AND m2.id <> m.id AND m2.id IN (e."lowId", e."highId")
         )`,
    )
    .get<{ n: number }>(hackathonId);
  const total = await db
    .prepare(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE status = 'confirmed')::int AS ok
       FROM encounters WHERE "hackathonId" = ?`,
    )
    .get<{ n: number; ok: number }>(hackathonId);

  return {
    presentes,
    comEncontro,
    pctComEncontro: presentes > 0 ? comEncontro / presentes : 0,
    entreFaculdades: Number(faculdades?.n ?? 0),
    timesFormados: Number(times?.n ?? 0),
    distribuicao: dist,
    poucosDados: presentes < 5,
    encontros: Number(total?.n ?? 0),
    confirmados: Number(total?.ok ?? 0),
  };
}

/** organizador liga/desliga encontros e missões */
export async function setEncountersOn(
  hackathonId: string,
  input: { on?: unknown; missions?: unknown },
): Promise<{ encountersOn: boolean; missionsOn: boolean }> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.on !== undefined) {
    sets.push(`"encountersOn" = ?`);
    params.push(input.on === true ? 1 : 0);
  }
  if (input.missions !== undefined) {
    sets.push(`"encounterMissionsOn" = ?`);
    params.push(input.missions === true ? 1 : 0);
  }
  if (sets.length === 0) throw new EncounterError("Nada pra salvar.", 400);
  await db.prepare(`UPDATE hackathons SET ${sets.join(", ")} WHERE id = ?`).run(...params, hackathonId);
  const row = await db
    .prepare(`SELECT "encountersOn", "encounterMissionsOn" FROM hackathons WHERE id = ?`)
    .get<{ encountersOn: number; encounterMissionsOn: number }>(hackathonId);
  return { encountersOn: Number(row?.encountersOn ?? 0) === 1, missionsOn: Number(row?.encounterMissionsOn ?? 0) === 1 };
}

export async function encountersOn(hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT "encountersOn" FROM hackathons WHERE id = ?`)
    .get<{ encountersOn: number }>(hackathonId);
  return Number(row?.encountersOn ?? 0) === 1;
}

export async function missionsOn(hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT "encounterMissionsOn" FROM hackathons WHERE id = ?`)
    .get<{ encounterMissionsOn: number }>(hackathonId);
  return Number(row?.encounterMissionsOn ?? 0) === 1;
}

// ---------- estado da tela ----------

export type MeetState = {
  hackathonId: string;
  enabled: boolean;
  missionsOn: boolean;
  gate: Gate;
  windowOpen: boolean;
  me: MyMeet | null;
  pendingIn: EncounterView[];
  pendingOut: EncounterView[];
  confirmed: EncounterView[];
  counts: EncounterCounters;
  missions: MissionProgress[];
  suggestions: MissionSuggestion[];
};

/**
 * Tudo que a tela precisa numa leitura: portas, meu código, pedidos dos dois
 * lados, confirmados, contadores, missões e sugestões. O polling de 10s da
 * tela bate aqui (só com a aba visível).
 */
export async function meetState(
  member: { id: number; username: string },
  hackathonId: string,
  now = new Date(),
): Promise<MeetState> {
  const [enabled, withMissions, gate] = await Promise.all([
    encountersOn(hackathonId),
    missionsOn(hackathonId),
    encounterGate(member.id, hackathonId, now),
  ]);
  const me = await myMeet(member.id, hackathonId);
  const empty = { people: 0, deep: 0, bridges: 0 };
  if (!enabled) {
    return {
      hackathonId,
      enabled: false,
      missionsOn: withMissions,
      gate,
      windowOpen: false,
      me,
      pendingIn: [],
      pendingOut: [],
      confirmed: [],
      counts: empty,
      missions: [],
      suggestions: [],
    };
  }
  const all = await listEncounters(member.id, member.username, hackathonId, now);
  const confirmed = all.filter((e) => e.status === "confirmed");
  const pending = all.filter((e) => e.status === "pending");
  const [counts, missions] = await Promise.all([
    encounterCounters(member.id, hackathonId),
    withMissions ? missionProgress(member.id, hackathonId) : Promise.resolve([]),
  ]);
  let suggestions: MissionSuggestion[] = [];
  if (withMissions && gate.ok && me && !me.paused) {
    const mine = await db
      .prepare(`SELECT institution, city FROM members WHERE id = ?`)
      .get<{ institution: string | null; city: string | null }>(member.id);
    suggestions = await suggestionsFor(member.id, hackathonId, mine?.institution ?? null, mine?.city ?? null);
  }
  return {
    hackathonId,
    enabled: true,
    missionsOn: withMissions,
    gate,
    windowOpen: gate.ok ? gate.windowOpen : false,
    me,
    pendingIn: pending.filter((e) => !e.mineRequest),
    pendingOut: pending.filter((e) => e.mineRequest),
    confirmed,
    counts,
    missions,
    suggestions,
  };
}

// ---------- fila offline (padrão offlineCheckin) ----------

export const SYNC_MAX_ITEMS = 20;

export type SyncedRead = {
  code: string;
  ok: boolean;
  kind?: ReadCodeErrorKind;
  message: string;
  encounterId?: number;
};

/**
 * Sobe a fila de leituras feitas sem rede. O servidor não confia no
 * aparelho: cada leitura passa pela MESMA porta e pelos mesmos limites de
 * readMeetCode (código, pausa, bloqueio, pendentes, janela). O horário fica
 * preso à janela do evento — o que vale é quando o servidor recebeu.
 */
export async function syncReads(
  member: { id: number; username: string },
  hackathonId: string,
  items: { code: string }[],
  now = new Date(),
): Promise<SyncedRead[]> {
  const out: SyncedRead[] = [];
  for (const item of items.slice(0, SYNC_MAX_ITEMS)) {
    const code = normalizeMeetCode(item.code);
    const r = await readMeetCode(member, hackathonId, code, now);
    out.push(
      r.ok
        ? { code, ok: true, message: `Encontro com @${r.peer.username} registrado.`, encounterId: r.encounterId }
        : { code, ok: false, kind: r.kind, message: r.message },
    );
  }
  return out;
}

/** o hackathon precisa existir (as rotas usam pra 404 antes de tudo) */
export async function editionOr404(hackathonId: string) {
  const h = await getHackathon(hackathonId);
  if (!h || !h.active) throw new EncounterError("Edição não encontrada.", 404);
  return h;
}
