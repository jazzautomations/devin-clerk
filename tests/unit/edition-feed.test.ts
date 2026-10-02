import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createPost, listPosts, toggleLike } from "@/lib/posts";

// spec 028 — mural da edição: posts.hackathonId nullable; NULL = global.
// Seeds de data/hackathons: alphaville é ativa/futura, unifacens ativa/passada.

const ED = "hack-inova-alphaville-2026";
const ED2 = "hack-inova-puc-saude-2026";

function makeMember(clerkId: string): number {
  db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("posts.hackathonId — schema guardado", () => {
  it("coluna existe via ALTER idempotente e default é NULL", () => {
    const cols = (
      db.prepare("PRAGMA table_info(posts)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("hackathonId");
    const m = makeMember("s0");
    db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'legado')").run(
      m,
    );
    const row = db
      .prepare("SELECT hackathonId FROM posts WHERE body = 'legado'")
      .get() as { hackathonId: string | null };
    expect(row.hackathonId).toBeNull();
  });
});

describe("createPost escopado", () => {
  it("persiste hackathonId e resolve hackathonName via join", () => {
    const m = makeMember("s1");
    const p = createPost(m, "demo saindo no mural", null, ED);
    expect(p.hackathonId).toBe(ED);
    expect(p.hackathonName).toBe("Hack Inova Alphaville");
  });

  it("sem escopo = post global (hackathonId/hackathonName null)", () => {
    const m = makeMember("s2");
    const p = createPost(m, "post global");
    expect(p.hackathonId).toBeNull();
    expect(p.hackathonName).toBeNull();
  });
});

describe("listPosts com scope", () => {
  it("omitido agrega global + edições; {hackathonId} isola; {global} filtra NULL", () => {
    const m = makeMember("s3");
    const g = createPost(m, "global s3");
    const a = createPost(m, "mural alpha", null, ED);
    const b = createPost(m, "mural puc", null, ED2);

    const all = listPosts(50);
    for (const id of [g.id, a.id, b.id]) {
      expect(all.some((p) => p.id === id)).toBe(true);
    }

    const wall = listPosts(50, null, { hackathonId: ED });
    expect(wall.length).toBeGreaterThan(0);
    expect(wall.every((p) => p.hackathonId === ED)).toBe(true);
    expect(wall.some((p) => p.id === a.id)).toBe(true);
    expect(wall.some((p) => p.id === g.id)).toBe(false);
    expect(wall.some((p) => p.id === b.id)).toBe(false);

    const onlyGlobal = listPosts(50, null, { global: true });
    expect(onlyGlobal.every((p) => p.hackathonId === null)).toBe(true);
    expect(onlyGlobal.some((p) => p.id === g.id)).toBe(true);
    expect(onlyGlobal.some((p) => p.id === a.id)).toBe(false);
  });

  it("likedByMe/likeCount funcionam na listagem escopada", () => {
    const a = makeMember("s4");
    const b = makeMember("s5");
    const post = createPost(a, "mural com like", null, ED);
    toggleLike(post.id, b);
    const wall = listPosts(50, b, { hackathonId: ED });
    const found = wall.find((p) => p.id === post.id);
    expect(found?.likedByMe).toBe(true);
    expect(found?.likeCount).toBe(1);
  });

  it("edição sem posts retorna lista vazia", () => {
    const wall = listPosts(50, null, { hackathonId: "hackinova-os-2-anhembi-2026" });
    expect(wall).toEqual([]);
  });
});
