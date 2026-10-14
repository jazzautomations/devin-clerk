import db from "@/lib/db";
import { publishAnnouncement } from "@/lib/announcements";

// Entrega de projeto (spec 034 §5). O projeto do time vive em team_projects
// como RASCUNHO (autosave). Enviar valida os obrigatórios da edição e grava
// uma versão imutável em project_submissions; editar antes do prazo e
// enviar de novo gera outra versão. No prazo (+ tolerância) o servidor
// TRAVA os campos avaliados; o júri avalia a última versão enviada até o
// prazo. "Depois do hackathon" (afterNotes) segue editável e fica fora do
// snapshot. Reabrir é só do organizador, com motivo, e fica no log.
//
// Edição sem submissionDeadline = modo antigo: sem trava, júri vê todo time
// (o arquivo das edições passadas não tem versão nenhuma).

export class EntryError extends Error {
  status: number;
  missing?: string[];
  constructor(message: string, status = 400, missing?: string[]) {
    super(message);
    this.status = status;
    this.missing = missing;
  }
}

// ---------- datas ----------

/** TEXT do banco (UTC, "YYYY-MM-DD HH:MM:SS" ou ISO) → Date; null se vazio/ruim */
export function parseDbTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? `${s}T00:00:00Z`
    : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
      ? s.replace(" ", "T")
      : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const toDbTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

// Brasília é UTC−3 fixo desde o fim do horário de verão (2019)
const BRT_OFFSET_MIN = -180;

/** "2026-10-20T18:00" (datetime-local, horário de Brasília) → TEXT UTC; "" → null */
export function brtInputToDb(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.trim())) {
    throw new EntryError("data inválida — use AAAA-MM-DDTHH:MM (horário de Brasília)");
  }
  const d = new Date(`${v.trim()}:00Z`);
  if (Number.isNaN(d.getTime())) throw new EntryError("data inválida");
  return toDbTime(new Date(d.getTime() - BRT_OFFSET_MIN * 60_000));
}

/** TEXT UTC → valor de <input type="datetime-local"> em Brasília */
export function dbToBrtInput(v: string | null): string {
  const d = parseDbTime(v);
  if (!d) return "";
  return new Date(d.getTime() + BRT_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}

const brtFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const brtTime = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "20/10 18:00" no horário de Brasília */
export function formatBrt(v: string | null | undefined): string {
  const d = parseDbTime(v);
  return d ? brtFmt.format(d).replace(",", "") : "";
}

/** "18:00" no horário de Brasília */
export function formatBrtTime(v: string | null | undefined): string {
  const d = parseDbTime(v);
  return d ? brtTime.format(d) : "";
}

// ---------- configuração da edição ----------

export type SubmissionSettings = {
  hackathonId: string;
  teamFormationDeadline: string | null;
  submissionOpensAt: string | null;
  submissionDeadline: string | null;
  submissionGraceMinutes: number;
  juryDeadline: string | null;
  requireRepo: boolean;
  requireVideo: boolean;
  requireSlides: boolean;
  requireAiUsage: boolean;
  entriesShowContent: boolean;
};

type SettingsRow = Omit<
  SubmissionSettings,
  "requireRepo" | "requireVideo" | "requireSlides" | "requireAiUsage" | "entriesShowContent"
> & {
  requireRepo: number;
  requireVideo: number;
  requireSlides: number;
  requireAiUsage: number;
  entriesShowContent: number;
};

export async function getSubmissionSettings(hackathonId: string): Promise<SubmissionSettings | null> {
  const r = await db
    .prepare(
      `SELECT id AS hackathonId, teamFormationDeadline, submissionOpensAt, submissionDeadline,
              submissionGraceMinutes, juryDeadline, requireRepo, requireVideo, requireSlides,
              requireAiUsage, entriesShowContent
       FROM hackathons WHERE id = ?`,
    )
    .get<SettingsRow>(hackathonId);
  if (!r) return null;
  return {
    ...r,
    requireRepo: r.requireRepo === 1,
    requireVideo: r.requireVideo === 1,
    requireSlides: r.requireSlides === 1,
    requireAiUsage: r.requireAiUsage === 1,
    entriesShowContent: r.entriesShowContent === 1,
  };
}

/** a edição usa o fluxo de entrega (tem prazo)? */
export const flowEnabled = (s: SubmissionSettings | null): s is SubmissionSettings =>
  !!s && !!parseDbTime(s.submissionDeadline);

/** instante da trava = prazo + tolerância; null = sem prazo */
export function lockAt(s: SubmissionSettings | null): Date | null {
  const d = parseDbTime(s?.submissionDeadline);
  return d ? new Date(d.getTime() + (s?.submissionGraceMinutes ?? 0) * 60_000) : null;
}

/** travado pra ESTE time agora? reabertura vigente destrava */
export function isLocked(
  s: SubmissionSettings | null,
  reopenedUntil: string | null,
  now = new Date(),
): boolean {
  const at = lockAt(s);
  if (!at || now.getTime() <= at.getTime()) return false;
  const reopen = parseDbTime(reopenedUntil);
  return !(reopen && now.getTime() < reopen.getTime());
}

/** prazo geral da edição passou (independe de reabertura de um time) */
export function deadlinePassed(s: SubmissionSettings | null, now = new Date()): boolean {
  const at = lockAt(s);
  return !!at && now.getTime() > at.getTime();
}

export type SettingsPatch = Partial<{
  teamFormationDeadline: string;
  submissionOpensAt: string;
  submissionDeadline: string;
  submissionGraceMinutes: number;
  juryDeadline: string;
  requireRepo: boolean;
  requireVideo: boolean;
  requireSlides: boolean;
  requireAiUsage: boolean;
  entriesShowContent: boolean;
}>;

/** organizador configura prazos (datetime-local em Brasília) e obrigatórios */
export async function updateSubmissionSettings(
  hackathonId: string,
  raw: Record<string, unknown>,
): Promise<SubmissionSettings> {
  const sets: string[] = [];
  const values: Record<string, unknown> = { id: hackathonId };
  for (const k of ["teamFormationDeadline", "submissionOpensAt", "submissionDeadline", "juryDeadline"] as const) {
    if (raw[k] === undefined) continue;
    sets.push(`${k} = @${k}`);
    values[k] = brtInputToDb(raw[k]);
  }
  if (raw.submissionGraceMinutes !== undefined) {
    const n = Number(raw.submissionGraceMinutes);
    if (!Number.isInteger(n) || n < 0 || n > 10) throw new EntryError("tolerância é de 0 a 10 minutos");
    sets.push("submissionGraceMinutes = @grace");
    values.grace = n;
  }
  for (const k of ["requireRepo", "requireVideo", "requireSlides", "requireAiUsage", "entriesShowContent"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== "boolean") throw new EntryError(`${k} precisa ser true/false`);
    sets.push(`${k} = @${k}`);
    values[k] = raw[k] ? 1 : 0;
  }
  if (sets.length === 0) throw new EntryError("nada pra atualizar");
  await db.prepare(`UPDATE hackathons SET ${sets.join(", ")} WHERE id = @id`).run(values);
  const s = (await getSubmissionSettings(hackathonId))!;
  const opens = parseDbTime(s.submissionOpensAt);
  const deadline = parseDbTime(s.submissionDeadline);
  if (opens && deadline && opens >= deadline) {
    throw new EntryError("abertura da entrega precisa ser antes do prazo");
  }
  return s;
}

// ---------- campos ----------

export type EntryLink = { label: string; url: string };

/** o que é avaliado (entra no snapshot) */
export type EntryFields = {
  title: string;
  tagline: string | null;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  slidesUrl: string | null;
  logoUrl: string | null;
  priorWork: string | null;
  technologies: string[];
  links: EntryLink[];
  socialPosts: string[];
  aiUsage: string | null;
  challengeIds: string[];
};

export type Snapshot = EntryFields & { members: string[] };

export const TAGLINE_MAX = 140;

/** sugestões da lista controlada; o time pode digitar outras */
export const TECH_SUGGESTIONS = [
  "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "Dart",
  "React", "Next.js", "Vue", "Svelte", "Node.js", "FastAPI", "Django", "Flutter", "React Native",
  "PostgreSQL", "SQLite", "MongoDB", "Supabase", "Firebase", "Redis",
  "OpenAI", "Claude", "Gemini", "LangChain", "Whisper", "Hugging Face",
  "WhatsApp API", "Docker", "Vercel", "AWS", "Google Cloud", "Arduino", "Figma",
];

const httpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u);

const EVALUATED = [
  "title", "tagline", "description", "repoUrl", "demoUrl", "videoUrl", "slidesUrl", "logoUrl",
  "priorWork", "technologies", "links", "socialPosts", "aiUsage", "challengeIds",
] as const;

function optText(v: unknown, key: string, max: number): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new EntryError(`${key} inválido`);
  const s = v.trim();
  if (s.length > max) throw new EntryError(`${key} longo demais (máx. ${max})`);
  return s || null;
}

function optUrl(v: unknown, key: string): string | null {
  const s = optText(v, key, 500);
  if (s && !httpUrl(s)) throw new EntryError(`${key}: URL inválida — só http(s)`);
  return s;
}

function stringList(v: unknown, key: string, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) throw new EntryError(`${key} precisa ser lista`);
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") throw new EntryError(`${key} inválido`);
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxLen) throw new EntryError(`${key}: item longo demais (máx. ${maxLen})`);
    if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > maxItems) throw new EntryError(`${key}: no máximo ${maxItems}`);
  return out;
}

/** valida o patch do rascunho; só devolve as chaves presentes */
export function validateDraftPatch(raw: Record<string, unknown>): Partial<EntryFields> & { afterNotes?: string | null } {
  const out: Partial<EntryFields> & { afterNotes?: string | null } = {};
  if (raw.title !== undefined) {
    const t = optText(raw.title, "title", 120);
    if (!t) throw new EntryError("título não pode ficar vazio");
    out.title = t;
  }
  if (raw.tagline !== undefined) out.tagline = optText(raw.tagline, "tagline", TAGLINE_MAX);
  if (raw.description !== undefined) out.description = optText(raw.description, "description", 10_000);
  if (raw.priorWork !== undefined) out.priorWork = optText(raw.priorWork, "priorWork", 2_000);
  if (raw.aiUsage !== undefined) out.aiUsage = optText(raw.aiUsage, "aiUsage", 2_000);
  for (const k of ["repoUrl", "demoUrl", "videoUrl", "slidesUrl", "logoUrl"] as const) {
    if (raw[k] !== undefined) out[k] = optUrl(raw[k], k);
  }
  if (raw.technologies !== undefined) out.technologies = stringList(raw.technologies, "technologies", 20, 40);
  if (raw.socialPosts !== undefined) {
    out.socialPosts = stringList(raw.socialPosts, "socialPosts", 10, 500);
    if (out.socialPosts.some((u) => !httpUrl(u))) throw new EntryError("socialPosts: URL inválida — só http(s)");
  }
  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links)) throw new EntryError("links precisa ser lista");
    const links: EntryLink[] = [];
    for (const l of raw.links) {
      const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const url = optUrl(o.url ?? null, "links.url");
      if (!url) continue;
      const label = optText(o.label ?? null, "links.label", 40) ?? url.replace(/^https?:\/\//, "").slice(0, 40);
      links.push({ label, url });
    }
    if (links.length > 10) throw new EntryError("links: no máximo 10");
    out.links = links;
  }
  if (raw.challengeIds !== undefined) out.challengeIds = stringList(raw.challengeIds, "challengeIds", 10, 80);
  if (raw.afterNotes !== undefined) out.afterNotes = optText(raw.afterNotes, "afterNotes", 4_000);
  return out;
}

/** o que falta pra enviar (vazio = pode enviar) — puro, testável */
export function missingRequired(f: EntryFields, s: SubmissionSettings | null): string[] {
  const miss: string[] = [];
  if (!f.title?.trim()) miss.push("título");
  if (!f.tagline?.trim()) miss.push("tagline");
  if (!f.description?.trim()) miss.push("descrição");
  if (!f.priorWork?.trim()) miss.push("trabalho anterior");
  if (f.technologies.length === 0) miss.push("tecnologias");
  if (s?.requireRepo && !f.repoUrl) miss.push("repositório");
  if (s?.requireVideo && !f.videoUrl) miss.push("vídeo");
  if (s?.requireSlides && !f.slidesUrl) miss.push("slides");
  if (s?.requireAiUsage && !f.aiUsage?.trim()) miss.push("uso de IA");
  return miss;
}

// ---------- leitura ----------

export type EntryStatus = "rascunho" | "enviado" | "travado" | "nao_entregue";

export const STATUS_LABEL: Record<EntryStatus, string> = {
  rascunho: "rascunho",
  enviado: "enviado",
  travado: "entregue",
  nao_entregue: "não entregue",
};

/** puro: versão enviada × trava */
export function deriveStatus(hasVersion: boolean, locked: boolean): EntryStatus {
  if (hasVersion) return locked ? "travado" : "enviado";
  return locked ? "nao_entregue" : "rascunho";
}

type ProjectRow = {
  title: string;
  tagline: string | null;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  slidesUrl: string | null;
  logoUrl: string | null;
  priorWork: string | null;
  technologies: string;
  links: string;
  socialPosts: string;
  aiUsage: string | null;
  stageVideoUrl: string | null;
  afterNotes: string | null;
  lastSavedAt: string | null;
};

const jsonList = <T>(v: string | null | undefined): T[] => {
  try {
    const parsed = JSON.parse(v ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

function fieldsFrom(p: ProjectRow, challengeIds: string[]): EntryFields {
  return {
    title: p.title,
    tagline: p.tagline,
    description: p.description,
    repoUrl: p.repoUrl,
    demoUrl: p.demoUrl,
    videoUrl: p.videoUrl,
    slidesUrl: p.slidesUrl,
    logoUrl: p.logoUrl,
    priorWork: p.priorWork,
    technologies: jsonList<string>(p.technologies),
    links: jsonList<EntryLink>(p.links),
    socialPosts: jsonList<string>(p.socialPosts),
    aiUsage: p.aiUsage,
    challengeIds,
  };
}

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Partial<Snapshot>;
  return {
    title: s.title ?? "",
    tagline: s.tagline ?? null,
    description: s.description ?? null,
    repoUrl: s.repoUrl ?? null,
    demoUrl: s.demoUrl ?? null,
    videoUrl: s.videoUrl ?? null,
    slidesUrl: s.slidesUrl ?? null,
    logoUrl: s.logoUrl ?? null,
    priorWork: s.priorWork ?? null,
    technologies: s.technologies ?? [],
    links: s.links ?? [],
    socialPosts: s.socialPosts ?? [],
    aiUsage: s.aiUsage ?? null,
    challengeIds: s.challengeIds ?? [],
    members: s.members ?? [],
  };
}

const sameFields = (a: EntryFields, b: EntryFields) =>
  EVALUATED.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

export type VersionInfo = { version: number; submittedAt: string; submittedBy: string | null };

export type Entry = {
  teamId: number;
  teamName: string;
  hackathonId: string;
  members: string[];
  finalist: boolean;
  reopenedUntil: string | null;
  status: EntryStatus;
  locked: boolean;
  /** rascunho tem mudança que ainda não foi enviada */
  dirty: boolean;
  fields: EntryFields | null;
  afterNotes: string | null;
  stageVideoUrl: string | null;
  lastSavedAt: string | null;
  versions: VersionInfo[];
  missing: string[];
  settings: SubmissionSettings;
};

async function challengeIdsOf(teamId: number): Promise<string[]> {
  return (
    await db
      .prepare("SELECT challengeId FROM project_challenges WHERE teamId = ? ORDER BY challengeId")
      .all<{ challengeId: string }>(teamId)
  ).map((r) => r.challengeId);
}

async function versionsOf(teamId: number): Promise<(VersionInfo & { snapshot: string })[]> {
  return db
    .prepare(
      `SELECT ps.version, ps.submittedAt, ps.snapshot, m.username AS submittedBy
       FROM project_submissions ps LEFT JOIN members m ON m.id = ps.submittedBy
       WHERE ps.teamId = ? ORDER BY ps.version`,
    )
    .all<VersionInfo & { snapshot: string }>(teamId);
}

export async function getEntry(teamId: number, now = new Date()): Promise<Entry | null> {
  const team = await db
    .prepare("SELECT id, name, hackathonId, finalist, reopenedUntil FROM teams WHERE id = ?")
    .get<{ id: number; name: string; hackathonId: string; finalist: number; reopenedUntil: string | null }>(teamId);
  if (!team) return null;
  const [settings, project, members, challengeIds, versions] = await Promise.all([
    getSubmissionSettings(team.hackathonId),
    db.prepare("SELECT * FROM team_projects WHERE teamId = ?").get<ProjectRow>(teamId),
    db
      .prepare("SELECT username FROM team_members WHERE teamId = ? ORDER BY username")
      .all<{ username: string }>(teamId),
    challengeIdsOf(teamId),
    versionsOf(teamId),
  ]);
  const locked = isLocked(settings, team.reopenedUntil, now);
  const fields = project ? fieldsFrom(project, challengeIds) : null;
  const last = versions.at(-1);
  return {
    teamId: team.id,
    teamName: team.name,
    hackathonId: team.hackathonId,
    members: members.map((m) => m.username),
    finalist: team.finalist === 1,
    reopenedUntil: team.reopenedUntil,
    status: deriveStatus(versions.length > 0, locked),
    locked,
    dirty: !!fields && (!last || !sameFields(fields, parseSnapshot(last.snapshot))),
    fields,
    afterNotes: project?.afterNotes ?? null,
    stageVideoUrl: project?.stageVideoUrl ?? null,
    lastSavedAt: project?.lastSavedAt ?? null,
    versions: versions.map(({ version, submittedAt, submittedBy }) => ({ version, submittedAt, submittedBy })),
    missing: fields ? missingRequired(fields, settings) : ["título"],
    settings: settings!,
  };
}

/** time do membro na edição → entrada; null sem time */
export async function myEntry(hackathonId: string, username: string, now = new Date()): Promise<Entry | null> {
  const row = await db
    .prepare(
      `SELECT t.id FROM teams t JOIN team_members tm ON tm.teamId = t.id
       WHERE t.hackathonId = ? AND tm.username = ? ORDER BY t.id LIMIT 1`,
    )
    .get<{ id: number }>(hackathonId, username);
  return row ? getEntry(row.id, now) : null;
}

async function requireTeamMember(teamId: number, username: string) {
  const team = await db
    .prepare("SELECT id, hackathonId, reopenedUntil FROM teams WHERE id = ?")
    .get<{ id: number; hackathonId: string; reopenedUntil: string | null }>(teamId);
  if (!team) throw new EntryError("time não encontrado", 404);
  const isMember = await db
    .prepare("SELECT 1 FROM team_members WHERE teamId = ? AND username = ?")
    .get(teamId, username);
  if (!isMember) throw new EntryError("só integrante mexe na entrega", 403);
  return team;
}

/**
 * Trava no servidor: campo avaliado não muda depois do prazo + tolerância
 * (a menos que o organizador tenha reaberto). Usado também pelo PATCH
 * antigo do time (lib/teams) pra não virar porta dos fundos.
 */
export async function assertEvaluatedEditable(teamId: number, now = new Date()) {
  const team = await db
    .prepare("SELECT hackathonId, reopenedUntil FROM teams WHERE id = ?")
    .get<{ hackathonId: string; reopenedUntil: string | null }>(teamId);
  if (!team) return;
  const s = await getSubmissionSettings(team.hackathonId);
  if (isLocked(s, team.reopenedUntil, now)) {
    throw new EntryError("prazo de entrega encerrado — projeto travado (só \"depois do hackathon\" segue editável)", 403);
  }
}

// ---------- escrita do time ----------

/**
 * Autosave do rascunho. Campo avaliado depois da trava → 403; afterNotes
 * ("depois do hackathon") passa sempre. Grava lastSavedAt.
 */
export async function saveDraft(
  teamId: number,
  member: { username: string },
  raw: Record<string, unknown>,
  now = new Date(),
): Promise<Entry> {
  const team = await requireTeamMember(teamId, member.username);
  const patch = validateDraftPatch(raw);
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new EntryError("nenhum campo pra salvar");
  if (keys.some((k) => k !== "afterNotes")) await assertEvaluatedEditable(teamId, now);

  if (patch.challengeIds) {
    const valid = new Set(
      (
        await db
          .prepare("SELECT id FROM challenges WHERE hackathonId = ? AND active = 1")
          .all<{ id: string }>(team.hackathonId)
      ).map((r) => r.id),
    );
    if (patch.challengeIds.some((c) => !valid.has(c))) throw new EntryError("desafio não é desta edição");
  }

  const cols: { col: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "challengeIds") continue;
    cols.push({ col: k, value: Array.isArray(v) ? JSON.stringify(v) : v });
  }

  await db.transaction(async () => {
    const exists = await db.prepare("SELECT 1 FROM team_projects WHERE teamId = ?").get(teamId);
    if (!exists) {
      if (!patch.title) throw new EntryError("dê um título pro projeto antes de salvar");
      await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, ?)").run(teamId, patch.title);
    }
    const sets = [...cols.map((c) => `${c.col} = ?`), "lastSavedAt = ?"];
    await db
      .prepare(`UPDATE team_projects SET ${sets.join(", ")} WHERE teamId = ?`)
      .run(...cols.map((c) => c.value), toDbTime(now), teamId);
    if (patch.challengeIds) {
      await db.prepare("DELETE FROM project_challenges WHERE teamId = ?").run(teamId);
      for (const c of patch.challengeIds) {
        await db.prepare("INSERT INTO project_challenges (teamId, challengeId) VALUES (?, ?)").run(teamId, c);
      }
    }
  })();
  return (await getEntry(teamId, now))!;
}

/**
 * Envia: valida obrigatórios da edição, exige integrantes aprovados, grava
 * versão nova (snapshot imutável) + evento e manda a confirmação pro time
 * pelos avisos (in-app + e-mail + zap com opt-in).
 */
export async function submitEntry(
  teamId: number,
  member: { id: number; username: string },
  now = new Date(),
): Promise<{ entry: Entry; version: number }> {
  const team = await requireTeamMember(teamId, member.username);
  const settings = await getSubmissionSettings(team.hackathonId);
  const opens = parseDbTime(settings?.submissionOpensAt);
  if (opens && now < opens) {
    throw new EntryError(`a entrega abre em ${formatBrt(settings!.submissionOpensAt)}`, 409);
  }
  await assertEvaluatedEditable(teamId, now);

  const entry = (await getEntry(teamId, now))!;
  if (!entry.fields) throw new EntryError("faltam campos obrigatórios: título, tagline, descrição", 400, ["título"]);
  const missing = missingRequired(entry.fields, settings);
  if (missing.length > 0) {
    throw new EntryError(`faltam campos obrigatórios: ${missing.join(", ")}`, 400, missing);
  }
  // integrantes só aprovados na edição (pendente/fila não conta como time)
  const notApproved = (
    await db
      .prepare(
        `SELECT tm.username FROM team_members tm
         LEFT JOIN members m ON m.username = tm.username
         LEFT JOIN registrations r ON r.memberId = m.id AND r.hackathonId = ?
         WHERE tm.teamId = ? AND (r.status IS NULL OR r.status <> 'approved')
         ORDER BY tm.username`,
      )
      .all<{ username: string }>(team.hackathonId, teamId)
  ).map((r) => r.username);
  if (notApproved.length > 0) {
    throw new EntryError(
      `integrante sem inscrição aprovada: ${notApproved.map((u) => `@${u}`).join(", ")}`,
      400,
      ["integrantes aprovados"],
    );
  }

  const snapshot: Snapshot = { ...entry.fields, members: entry.members };
  const version = await db.transaction(async () => {
    const row = await db
      .prepare(
        `INSERT INTO project_submissions (teamId, version, snapshot, submittedBy, submittedAt)
         VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM project_submissions WHERE teamId = ?), ?, ?, ?)
         RETURNING version`,
      )
      .get<{ version: number }>(teamId, teamId, JSON.stringify(snapshot), member.id, toDbTime(now));
    await db
      .prepare(
        `INSERT INTO submission_events (hackathonId, teamId, kind, memberId, version)
         VALUES (?, ?, 'enviado', ?, ?)`,
      )
      .run(team.hackathonId, teamId, member.id, row!.version);
    await publishAnnouncement(team.hackathonId, null, {
      system: true,
      audience: "time",
      teamId,
      title: `Entrega recebida — versão ${row!.version}`,
      body:
        `"${snapshot.title}" foi enviado por @${member.username} às ${formatBrtTime(toDbTime(now))}. ` +
        (settings?.submissionDeadline
          ? `Dá pra editar e enviar de novo até ${formatBrt(settings.submissionDeadline)}; o júri avalia a última versão enviada até o prazo.`
          : "Dá pra editar e enviar de novo; o júri avalia a última versão enviada."),
    });
    return row!.version;
  })();
  return { entry: (await getEntry(teamId, now))!, version };
}

// ---------- organização ----------

async function requireEditionTeam(hackathonId: string, teamId: number) {
  const ok =
    Number.isInteger(teamId) &&
    (await db.prepare("SELECT 1 FROM teams WHERE id = ? AND hackathonId = ?").get(teamId, hackathonId));
  if (!ok) throw new EntryError("time não encontrado", 404);
}

/** reabre a entrega de um time por N minutos — motivo obrigatório, fica no log */
export async function reopenEntry(
  hackathonId: string,
  teamId: number,
  actorId: number,
  input: { reason?: unknown; minutes?: unknown },
  now = new Date(),
): Promise<{ reopenedUntil: string }> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new EntryError("motivo obrigatório pra reabrir");
  if (reason.length > 500) throw new EntryError("motivo longo demais (máx. 500)");
  const minutes = input.minutes === undefined ? 60 : Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    throw new EntryError("reabertura é de 5 a 1440 minutos");
  }
  await requireEditionTeam(hackathonId, teamId);
  const until = toDbTime(new Date(now.getTime() + minutes * 60_000));
  await db.transaction(async () => {
    await db.prepare("UPDATE teams SET reopenedUntil = ? WHERE id = ?").run(until, teamId);
    await db
      .prepare(
        `INSERT INTO submission_events (hackathonId, teamId, kind, memberId, reason)
         VALUES (?, ?, 'reaberto', ?, ?)`,
      )
      .run(hackathonId, teamId, actorId, reason);
  })();
  return { reopenedUntil: until };
}

/** vídeo do palco (gravação da organização) — staff/organizador */
export async function setStageVideo(
  hackathonId: string,
  teamId: number,
  actorId: number,
  url: unknown,
): Promise<void> {
  const v = optUrl(url ?? null, "stageVideoUrl");
  await requireEditionTeam(hackathonId, teamId);
  const res = await db.prepare("UPDATE team_projects SET stageVideoUrl = ? WHERE teamId = ?").run(v, teamId);
  if (res.changes === 0) throw new EntryError("time sem projeto", 404);
  await db
    .prepare("INSERT INTO submission_events (hackathonId, teamId, kind, memberId) VALUES (?, ?, 'palco', ?)")
    .run(hackathonId, teamId, actorId);
}

/** rodada opcional: marca/desmarca finalista */
export async function setFinalist(hackathonId: string, teamId: number, finalist: unknown) {
  if (typeof finalist !== "boolean") throw new EntryError("finalist precisa ser true/false");
  await requireEditionTeam(hackathonId, teamId);
  await db.prepare("UPDATE teams SET finalist = ? WHERE id = ?").run(finalist ? 1 : 0, teamId);
}

// ---------- júri: versão avaliada ----------

export type JudgedVersion = { version: number; submittedAt: string; snapshot: Snapshot };

/**
 * Versão que o júri avalia, por time da edição: a última enviada até a
 * trava. Time que só enviou depois (reaberto sem ter entregue no prazo)
 * cai na última versão que tem. Sem prazo = última versão.
 */
export async function judgedVersions(hackathonId: string): Promise<Map<number, JudgedVersion>> {
  const settings = await getSubmissionSettings(hackathonId);
  const at = lockAt(settings);
  const rows = await db
    .prepare(
      `SELECT ps.teamId, ps.version, ps.submittedAt, ps.snapshot
       FROM project_submissions ps JOIN teams t ON t.id = ps.teamId
       WHERE t.hackathonId = ? ORDER BY ps.teamId, ps.version`,
    )
    .all<{ teamId: number; version: number; submittedAt: string; snapshot: string }>(hackathonId);
  const map = new Map<number, JudgedVersion>();
  const fallback = new Map<number, JudgedVersion>();
  for (const r of rows) {
    const v = { version: r.version, submittedAt: r.submittedAt, snapshot: parseSnapshot(r.snapshot) };
    fallback.set(r.teamId, v);
    const t = parseDbTime(r.submittedAt);
    if (!at || (t && t.getTime() <= at.getTime())) map.set(r.teamId, v);
  }
  for (const [teamId, v] of fallback) if (!map.has(teamId)) map.set(teamId, v);
  return map;
}

/** desafios por time: do snapshot avaliado no fluxo novo; do rascunho no modo antigo */
export async function challengesByTeam(hackathonId: string): Promise<Map<number, string[]>> {
  const settings = await getSubmissionSettings(hackathonId);
  const map = new Map<number, string[]>();
  if (flowEnabled(settings)) {
    for (const [teamId, v] of await judgedVersions(hackathonId)) map.set(teamId, v.snapshot.challengeIds);
    return map;
  }
  const rows = await db
    .prepare(
      `SELECT pc.teamId, pc.challengeId FROM project_challenges pc
       JOIN teams t ON t.id = pc.teamId WHERE t.hackathonId = ?`,
    )
    .all<{ teamId: number; challengeId: string }>(hackathonId);
  for (const r of rows) map.set(r.teamId, [...(map.get(r.teamId) ?? []), r.challengeId]);
  return map;
}

/**
 * SQL: o time `alias` pode ir pro júri/voto? Fluxo novo = tem versão
 * enviada; modo antigo (sem prazo) = todo time. Precisa de hackathons
 * juntado como `h`.
 */
export const ELIGIBLE_SQL = (alias = "t") =>
  `(h.submissionDeadline IS NULL OR EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = ${alias}.id))`;

/**
 * Pra integração com voto popular (outra frente): só time enviado/travado
 * vota/recebe voto. Modo antigo: time com projeto cadastrado.
 */
export async function isEligibleForVoting(teamId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN h.submissionDeadline IS NULL
                   THEN EXISTS (SELECT 1 FROM team_projects tp WHERE tp.teamId = t.id)
                   ELSE EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = t.id) END AS ok
       FROM teams t JOIN hackathons h ON h.id = t.hackathonId WHERE t.id = ?`,
    )
    .get<{ ok: boolean }>(teamId);
  return !!row?.ok;
}

// ---------- painel ----------

export type AdminEntryRow = {
  teamId: number;
  teamName: string;
  members: string[];
  title: string | null;
  status: EntryStatus;
  versions: number;
  lastSubmittedAt: string | null;
  lastSavedAt: string | null;
  reopenedUntil: string | null;
  stageVideoUrl: string | null;
  finalist: boolean;
  dirty: boolean;
};

export async function listEntriesForAdmin(hackathonId: string, now = new Date()): Promise<AdminEntryRow[]> {
  const ids = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? ORDER BY name")
    .all<{ id: number }>(hackathonId);
  const entries = await Promise.all(ids.map((r) => getEntry(r.id, now)));
  return entries
    .filter((e): e is Entry => !!e)
    .map((e) => ({
      teamId: e.teamId,
      teamName: e.teamName,
      members: e.members,
      title: e.fields?.title ?? null,
      status: e.status,
      versions: e.versions.length,
      lastSubmittedAt: e.versions.at(-1)?.submittedAt ?? null,
      lastSavedAt: e.lastSavedAt,
      reopenedUntil: e.reopenedUntil,
      stageVideoUrl: e.stageVideoUrl,
      finalist: e.finalist,
      dirty: e.dirty,
    }));
}

export type EntryEvent = {
  id: number;
  teamName: string;
  kind: string;
  username: string | null;
  version: number | null;
  reason: string | null;
  createdAt: string;
};

export async function listEntryEvents(hackathonId: string, limit = 100): Promise<EntryEvent[]> {
  return db
    .prepare(
      `SELECT e.id, t.name AS teamName, e.kind, m.username, e.version, e.reason, e.createdAt
       FROM submission_events e JOIN teams t ON t.id = e.teamId
       LEFT JOIN members m ON m.id = e.memberId
       WHERE e.hackathonId = ? ORDER BY e.id DESC LIMIT ?`,
    )
    .all<EntryEvent>(hackathonId, limit);
}
