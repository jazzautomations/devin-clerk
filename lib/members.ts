import db from "@/lib/db";
import { claimEditionInvites } from "@/lib/roles";
import { claimSponsorInvites } from "@/lib/editionSponsors";
import { toLikePattern } from "@/lib/search";

// spec 032 — "campanhas" públicas contam só inscrições aprovadas (pedido
// pendente não é campanha)
export type Member = {
  id: number;
  clerkId: string;
  username: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  bio: string | null;
  skills: string[];
  github: string | null;
  linkedin: string | null;
  twitter: string | null;
  website: string | null;
  headline: string | null;
  persona: string | null;
  personas: string[];
  role: "member" | "admin";
  xp: number;
  badges?: number;
  campaigns?: number;
  cards?: number;
  createdAt: string;
  usernameChangedAt?: string | null;
};

type MemberRow = Omit<Member, "skills" | "personas"> & { skills: string; personas: string };

function toMember(row: MemberRow): Member {
  return { ...row, skills: JSON.parse(row.skills), personas: JSON.parse(row.personas ?? "[]") };
}

export function adminEmails(): string[] {
  return (process.env.HACKAHUB_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function getOrCreateMember(clerkUser: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  imageUrl?: string | null;
}): Promise<Member> {
  const existing = await db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkUser.id) as MemberRow | undefined;
  if (existing) {
    // avatar é dado do Clerk: sync na materialização — truthy e diferente
    // atualiza; nulo preserva (leitura nunca apaga o que já foi gravado)
    if (clerkUser.imageUrl && clerkUser.imageUrl !== existing.avatarUrl) {
      await db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(
        clerkUser.imageUrl,
        existing.id,
      );
      existing.avatarUrl = clerkUser.imageUrl;
    }
    // e-mail entrou na lista de admins depois do cadastro → promove
    if (existing.role !== "admin" && adminEmails().includes(existing.email.toLowerCase())) {
      await db.prepare("UPDATE members SET role = 'admin' WHERE id = ?").run(existing.id);
      existing.role = "admin";
    }
    return toMember(existing);
  }

  const username = await generateUsername(clerkUser.firstName, clerkUser.lastName, clerkUser.email);

  // admin global vem de lista explícita (e-mail verificado no Clerk) — o
  // antigo "primeiro cadastro vira admin" entregava o painel a quem chegasse
  // primeiro num site público
  const isAdmin = adminEmails().includes(clerkUser.email.toLowerCase());

  await db.prepare(
    `INSERT INTO members (clerkId, username, name, email, role, avatarUrl)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    clerkUser.id,
    username,
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    clerkUser.email,
    isAdmin ? "admin" : "member",
    clerkUser.imageUrl ?? null,
  );
  const created = await db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkUser.id) as MemberRow;
  await claimEditionInvites(created.id, created.email);
  await claimSponsorInvites(created.id, created.email);
  return toMember(created);
}

// ---------- username (frente N #8) ----------
// O automático antigo era o e-mail sem pontuação ("joaosilva92", "hacker3")
// e, no pior caso, nada legível. Agora nasce do nome (ou do e-mail): slug
// pt-BR sem acento, sem partícula (da/de/dos…), sem número; sufixo curto
// (2, 3…) só quando colide. Quem quiser troca UMA vez no perfil — o antigo
// fica reservado e /u/antigo redireciona (308) pro novo.

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const USERNAME_MAX = 20;
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e", "di", "du", "del", "van", "von"]);
const RESERVED = new Set([
  "admin", "administrador", "api", "hackahub", "hackinova", "hack_inova", "suporte", "staff",
  "organizacao", "organizador", "root", "null", "undefined", "me", "eu", "perfil", "sistema",
]);

/** "João" → "joao"; só [a-z0-9] */
export function slugPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isReservedUsername(u: string): boolean {
  return RESERVED.has(u) || u.startsWith("removido") || u.startsWith("deleted");
}

/** candidatos em ordem de preferência: nome+sobrenome, nome, e-mail */
export function usernameCandidates(first: string | null, last: string | null, email: string): string[] {
  const words = `${first ?? ""} ${last ?? ""}`
    .split(/\s+/)
    .map(slugPart)
    .map((w) => w.replace(/[0-9]/g, ""))
    .filter((w) => w && !PARTICLES.has(w));
  const local = email.split("@")[0].split("+")[0];
  const fromEmail = local
    .split(/[._\-]+/)
    .map(slugPart)
    .map((w) => w.replace(/[0-9]/g, ""))
    .filter(Boolean)
    .join("");
  const out: string[] = [];
  const push = (c: string) => {
    const v = c.slice(0, USERNAME_MAX);
    if (v.length >= 3 && !isReservedUsername(v) && !out.includes(v)) out.push(v);
  };
  if (words.length >= 2) push(words[0] + words[words.length - 1]);
  if (words.length >= 1) push(words[0]);
  push(fromEmail);
  if (out.length === 0) out.push("hacker");
  return out;
}

async function usernameTaken(u: string, exceptMemberId: number | null = null): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM members WHERE username = ? AND (?::int IS NULL OR id <> ?::int)
       UNION ALL
       SELECT 1 FROM username_redirects WHERE oldUsername = ? AND (?::int IS NULL OR memberId <> ?::int)
       LIMIT 1`,
    )
    .get(u, exceptMemberId, exceptMemberId, u, exceptMemberId, exceptMemberId);
  return Boolean(row);
}

export async function generateUsername(first: string | null, last: string | null, email: string): Promise<string> {
  const candidates = usernameCandidates(first, last, email);
  for (const c of candidates) if (!(await usernameTaken(c))) return c;
  const base = candidates[0].slice(0, USERNAME_MAX - 2);
  for (let i = 2; i < 100; i++) {
    const c = `${base}${i}`;
    if (!(await usernameTaken(c))) return c;
  }
  // 98 homônimos: sufixo aleatório curto
  for (;;) {
    const c = `${candidates[0].slice(0, USERNAME_MAX - 4)}${Math.random().toString(36).slice(2, 6)}`;
    if (!(await usernameTaken(c))) return c;
  }
}

export class UsernameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Troca única do username. team_members guarda o username como texto
 * (vínculo do time) e muda junto; o antigo vai pra username_redirects
 * (reservado + redirect de /u/antigo). Certificados usam código próprio e
 * memberId — não mudam. Voltar pro próprio @ antigo não é permitido
 * (é a segunda troca).
 */
export async function changeUsername(memberId: number, raw: unknown): Promise<{ username: string; old: string }> {
  const next = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(next)) {
    throw new UsernameError("username: 3 a 20 caracteres, só letras sem acento, números e _");
  }
  if (isReservedUsername(next)) throw new UsernameError("esse username é reservado");
  return db.transaction(async () => {
    const m = await db
      .prepare(`SELECT username, usernameChangedAt FROM members WHERE id = ? FOR UPDATE`)
      .get<{ username: string; usernameChangedAt: string | null }>(memberId);
    if (!m) throw new UsernameError("membro não encontrado", 404);
    if (m.usernameChangedAt) throw new UsernameError("o username só pode ser trocado uma vez", 409);
    if (m.username === next) throw new UsernameError("esse já é o teu username");
    if (await usernameTaken(next)) throw new UsernameError("username em uso", 409);
    await db
      .prepare(`UPDATE members SET username = ?, usernameChangedAt = datetime('now') WHERE id = ?`)
      .run(next, memberId);
    await db.prepare("UPDATE team_members SET username = ? WHERE username = ?").run(next, m.username);
    await db
      .prepare("INSERT INTO username_redirects (oldUsername, memberId) VALUES (?, ?)")
      .run(m.username, memberId);
    return { username: next, old: m.username };
  })();
}

/** /u/antigo → username atual (null se não há redirect) */
export async function resolveUsernameRedirect(old: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT m.username FROM username_redirects r JOIN members m ON m.id = r.memberId
       WHERE r.oldUsername = ?`,
    )
    .get<{ username: string }>(old.toLowerCase());
  return row?.username ?? null;
}

export async function getMemberByUsername(username: string): Promise<Member | null> {
  const row = await db
    .prepare("SELECT * FROM members WHERE username = ?")
    .get(username) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export async function listMembers(limit = 60): Promise<Member[]> {
  const rows = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations r WHERE r.memberId = m.id AND r.status = 'approved') AS campaigns,
              (SELECT COUNT(*) FROM member_cards mc WHERE mc.memberId = m.id) AS cards
       FROM members m ORDER BY m.id DESC LIMIT ?`,
    )
    .all(limit) as MemberRow[];
  return rows.map(toMember);
}

export type LeaderboardSort = "xp" | "recent";

// ranking público: xp desc com desempate determinístico por username;
// "recent" ordena por entrada — ordem cronológica não é mérito
export async function listLeaderboard(
  sort: LeaderboardSort = "xp",
  limit = 100,
  q?: string,
): Promise<Member[]> {
  const orderBy =
    sort === "recent"
      ? "m.createdAt DESC, m.id DESC"
      : "m.xp DESC, m.username ASC";
  // ?q= (spec 023): username/name/headline/skills — LIKE com curinga escapado
  // (toLikePattern); lib/db traduz LIKE → ILIKE (case-insensitive)
  const rows = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM member_badges mb WHERE mb.memberId = m.id) AS badges,
              (SELECT COUNT(*) FROM registrations r WHERE r.memberId = m.id AND r.status = 'approved') AS campaigns,
              (SELECT COUNT(*) FROM member_cards mc WHERE mc.memberId = m.id) AS cards
       FROM members m
       WHERE (@q::text IS NULL
              OR m.username LIKE @q ESCAPE '\\'
              OR m.name LIKE @q ESCAPE '\\'
              OR m.headline LIKE @q ESCAPE '\\'
              OR m.skills LIKE @q ESCAPE '\\')
       ORDER BY ${orderBy} LIMIT @limit`,
    )
    .all({ q: toLikePattern(q), limit }) as MemberRow[];
  return rows.map(toMember);
}

export async function getMemberByClerkId(clerkId: string): Promise<Member | null> {
  const row = await db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkId) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export async function updateMemberProfile(
  clerkId: string,
  patch: {
    name?: string;
    bio?: string;
    skills?: string[];
    github?: string;
    linkedin?: string;
    twitter?: string;
    website?: string;
    headline?: string;
    persona?: string;
    personas?: string[];
  },
): Promise<void> {
  await db.prepare(
    `UPDATE members SET
       name = COALESCE(@name, name),
       bio = COALESCE(@bio, bio),
       skills = COALESCE(@skills, skills),
       github = COALESCE(@github, github),
       linkedin = COALESCE(@linkedin, linkedin),
       twitter = COALESCE(@twitter, twitter),
       website = COALESCE(@website, website),
       headline = COALESCE(@headline, headline),
       persona = CASE WHEN @personasSet::int = 1 THEN @primary ELSE COALESCE(@persona, persona) END,
       personas = COALESCE(@personas, personas)
     WHERE clerkId = @clerkId`,
  ).run({
    clerkId,
    name: patch.name ?? null,
    bio: patch.bio ?? null,
    skills: patch.skills ? JSON.stringify(patch.skills) : null,
    github: patch.github ?? null,
    linkedin: patch.linkedin ?? null,
    twitter: patch.twitter ?? null,
    website: patch.website ?? null,
    headline: patch.headline ?? null,
    persona: patch.persona ?? null,
    personasSet: patch.personas ? 1 : 0,
    primary: patch.personas?.[0] ?? null,
    personas: patch.personas ? JSON.stringify(patch.personas) : null,
  });
}
