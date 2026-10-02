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

  db.prepare(
    `INSERT INTO members (clerkId, username, name, email)
     VALUES (?, ?, ?, ?)`,
  ).run(
    clerkUser.id,
    username,
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    clerkUser.email,
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

export function getMemberByClerkId(clerkId: string): Member | null {
  const row = db
    .prepare("SELECT * FROM members WHERE clerkId = ?")
    .get(clerkId) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export function updateMemberProfile(
  clerkId: string,
  patch: { name?: string; bio?: string; skills?: string[]; github?: string },
): void {
  db.prepare(
    `UPDATE members SET
       name = COALESCE(@name, name),
       bio = COALESCE(@bio, bio),
       skills = COALESCE(@skills, skills),
       github = COALESCE(@github, github)
     WHERE clerkId = @clerkId`,
  ).run({
    clerkId,
    name: patch.name ?? null,
    bio: patch.bio ?? null,
    skills: patch.skills ? JSON.stringify(patch.skills) : null,
    github: patch.github ?? null,
  });
}
