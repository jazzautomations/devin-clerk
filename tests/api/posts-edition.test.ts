import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

// spec 028 — POST /api/posts com hackathonId (mural da edição) e
// GET /api/posts?h= (filtro). Gates: 404 edição inexistente, 400 inativa,
// 403 não-inscrito, 401 deslogado.

const clerk = vi.hoisted(() => ({ uid: "clerk_mural" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const ED = "hack-inova-alphaville-2026"; // seed ativa
const INACTIVE = "edicao-inativa-e2e";

db.prepare(
  `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, active)
   VALUES (?, 'Edição Inativa', 'T', '2030-01-01T00:00:00Z', 'online', 'https://t.dev', 0)`,
).run(INACTIVE);

function memberId(clerkId: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const req = (body: unknown) =>
  new Request("http://t/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  clerk.uid = "clerk_mural";
  memberId("clerk_mural");
  db.prepare("DELETE FROM likes").run();
  db.prepare("DELETE FROM post_comments").run();
  db.prepare("DELETE FROM posts").run();
  db.prepare("DELETE FROM registrations WHERE memberId = ?").run(
    memberId("clerk_mural"),
  );
});

describe("POST /api/posts com hackathonId", () => {
  it("401 — deslogado", async () => {
    clerk.uid = null;
    const { POST } = await import("@/app/api/posts/route");
    const res = await POST(req({ body: "oi", hackathonId: ED }));
    expect(res.status).toBe(401);
  });

  it("404 — edição inexistente; 400 — edição inativa; 400 — hackathonId não-string", async () => {
    const { POST } = await import("@/app/api/posts/route");
    const nf = await POST(req({ body: "oi", hackathonId: "nope-404" }));
    expect(nf.status).toBe(404);

    const inativa = await POST(req({ body: "oi", hackathonId: INACTIVE }));
    expect(inativa.status).toBe(400);

    const badType = await POST(req({ body: "oi", hackathonId: 42 }));
    expect(badType.status).toBe(400);
  });

  it("403 — membro não inscrito na edição", async () => {
    const { POST } = await import("@/app/api/posts/route");
    const res = await POST(req({ body: "oi", hackathonId: ED }));
    expect(res.status).toBe(403);
    const { error } = await res.json();
    expect(error).toBe("inscreve-te primeiro");
  });

  it("201 — inscrito posta no mural; post traz hackathonId + hackathonName", async () => {
    const mid = memberId("clerk_mural");
    db.prepare(
      "INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?)",
    ).run(mid, ED);
    const { POST } = await import("@/app/api/posts/route");
    const res = await POST(req({ body: "  demo no mural  ", hackathonId: ED }));
    expect(res.status).toBe(201);
    const { post } = await res.json();
    expect(post.hackathonId).toBe(ED);
    expect(post.hackathonName).toBe("Hack Inova Alphaville");
    expect(post.body).toBe("demo no mural");
  });

  it("201 — sem hackathonId (ou vazio/null) segue global, sem escopo", async () => {
    const { POST } = await import("@/app/api/posts/route");
    for (const extra of [{}, { hackathonId: "" }, { hackathonId: null }]) {
      const res = await POST(req({ body: "global", ...extra }));
      expect(res.status).toBe(201);
      const { post } = await res.json();
      expect(post.hackathonId).toBeNull();
    }
  });
});

describe("GET /api/posts?h=", () => {
  it("filtra pela edição; sem ?h= agrega global + edição", async () => {
    const mid = memberId("clerk_mural");
    db.prepare(
      "INSERT INTO posts (memberId, body, hackathonId) VALUES (?, 'no mural', ?), (?, 'global', NULL)",
    ).run(mid, ED, mid);
    const { GET } = await import("@/app/api/posts/route");

    const scoped = await GET(new Request(`http://t/api/posts?h=${ED}`));
    expect(scoped.status).toBe(200);
    const { posts: wall } = await scoped.json();
    expect(wall).toHaveLength(1);
    expect(wall[0].body).toBe("no mural");
    expect(wall[0].hackathonName).toBe("Hack Inova Alphaville");

    const all = await GET(new Request("http://t/api/posts"));
    const { posts } = await all.json();
    expect(posts).toHaveLength(2);
  });

  it("404 — edição inexistente ou inativa", async () => {
    const { GET } = await import("@/app/api/posts/route");
    const nf = await GET(new Request("http://t/api/posts?h=nope-404"));
    expect(nf.status).toBe(404);
    const inativa = await GET(new Request(`http://t/api/posts?h=${INACTIVE}`));
    expect(inativa.status).toBe(404);
  });
});
