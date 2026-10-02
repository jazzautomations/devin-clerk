import db from "@/lib/db";

export type Member = {
  id: number;
  clerkId: string;
  username: string;
  name: string | null;
  email: string;
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

export function getOrCreateMember(clerkUser: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}): Member {
  const existing = db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkUser.id) as MemberRow | undefined;
  if (existing) return toMember(existing);

  const base = clerkUser.email.split("@")[0].replace(/[^a-z0-9_]/gi, "").toLowerCase() || "hacker";
  let username = base;
  let i = 1;
  while (db.prepare("SELECT 1 FROM members WHERE username = ?").get(username)) {
    username = `${base}${i++}`;
  }

  const isFirst =
    (db.prepare("SELECT COUNT(*) AS n FROM members").get() as { n: number })
      .n === 0;

  db.prepare(
    `INSERT INTO members (clerkId, username, name, email, role)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    clerkUser.id,
    username,
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    clerkUser.email,
    isFirst ? "admin" : "member",
  );
  return toMember(
    db.prepare("SELECT * FROM members WHERE clerkId = ?").get(clerkUser.id) as MemberRow,
  );
}

export function getMemberByUsername(username: string): Member | null {
  const row = db
    .prepare("SELECT * FROM members WHERE username = ?")
    .get(username) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export function listMembers(limit = 60): Member[] {
  const rows = db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM registrations r WHERE r.memberId = m.id) AS campaigns,
              (SELECT COUNT(*) FROM member_cards mc WHERE mc.memberId = m.id) AS cards
       FROM members m ORDER BY m.id DESC LIMIT ?`,
    )
    .all(limit) as MemberRow[];
  return rows.map(toMember);
}

export type LeaderboardSort = "xp" | "recent";

// ranking público: xp desc com desempate determinístico por username;
// "recent" ordena por entrada — ordem cronológica não é mérito
export function listLeaderboard(
  sort: LeaderboardSort = "xp",
  limit = 100,
): Member[] {
  const orderBy =
    sort === "recent"
      ? "m.createdAt DESC, m.id DESC"
      : "m.xp DESC, m.username ASC";
  const rows = db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM member_badges mb WHERE mb.memberId = m.id) AS badges,
              (SELECT COUNT(*) FROM registrations r WHERE r.memberId = m.id) AS campaigns,
              (SELECT COUNT(*) FROM member_cards mc WHERE mc.memberId = m.id) AS cards
       FROM members m ORDER BY ${orderBy} LIMIT ?`,
    )
    .all(limit) as MemberRow[];
  return rows.map(toMember);
}

export function getMemberByClerkId(clerkId: string): Member | null {
  const row = db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkId) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export function updateMemberProfile(
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
): void {
  db.prepare(
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
