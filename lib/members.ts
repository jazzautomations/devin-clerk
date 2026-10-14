import db from "@/lib/db";
import { claimEditionInvites } from "@/lib/roles";
import { toLikePattern } from "@/lib/search";

// migração idempotente — avatarUrl vive aqui e não no schema principal de
// lib/db.ts (trabalho paralelo naquele arquivo)
// spec 032 — "campanhas" públicas contam só inscrições aprovadas (pedido
// pendente não é campanha); guarda da coluna status — dona do schema é
// lib/registrations, aqui garante pra quem importa members.ts direto
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
  role: "member" | "admin";
  xp: number;
  badges?: number;
  campaigns?: number;
  cards?: number;
  createdAt: string;
};

type MemberRow = Omit<Member, "skills"> & { skills: string };

function toMember(row: MemberRow): Member {
  return { ...row, skills: JSON.parse(row.skills) };
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

  const base = clerkUser.email.split("@")[0].replace(/[^a-z0-9_]/gi, "").toLowerCase() || "hacker";
  let username = base;
  let i = 1;
  while (await db.prepare("SELECT 1 FROM members WHERE username = ?").get(username)) {
    username = `${base}${i++}`;
  }

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
  return toMember(created);
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
  // (toLikePattern); lib/db traduz LIKE → ILIKE (case-insensitive como era no sqlite)
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
       persona = COALESCE(@persona, persona)
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
  });
}
