import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import "@/lib/teamboard";

const clerk = vi.hoisted(() => ({ uid: "clerk_seeker" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const HID = "hack-inova-alphaville-2026"; // edição futura e ativa (seed)

function memberId(clerkId: string, role = "member"): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`, role);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

function registerMember(mid: number, hid = HID) {
  db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(mid, hid);
}

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

const ctx = (id = HID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  clerk.uid = "clerk_seeker";
  db.prepare("DELETE FROM looking_for_team").run();
});

describe("GET /api/hackathons/[id]/team-board — público", () => {
  it("200 com entries ativas + join; 404 edição inexistente", async () => {
    const { GET } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    clerk.uid = null; // leitura pública
    const m = memberId("clerk_poster");
    registerMember(m);
    db.prepare(
      "INSERT INTO looking_for_team (memberId, hackathonId, skills, need) VALUES (?, ?, ?, ?)",
    ).run(m, HID, '["react"]', "busco dev back");

    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].need).toBe("busco dev back");
    expect(entries[0].skills).toEqual(["react"]);
    expect(entries[0].username).toBe("u_clerk_poster");

    const nf = await GET(req("GET"), ctx("nao-existe"));
    expect(nf.status).toBe(404);
  });

  it("não lista entries desativadas", async () => {
    const { GET } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const m = memberId("clerk_poster");
    db.prepare(
      "INSERT INTO looking_for_team (memberId, hackathonId, need, active) VALUES (?, ?, 'off', 0)",
    ).run(m, HID);
    const res = await GET(req("GET"), ctx());
    const { entries } = await res.json();
    expect(entries).toHaveLength(0);
  });
});

describe("POST /api/hackathons/[id]/team-board", () => {
  it("201 — primeiro anúncio paga +10xp uma vez", async () => {
    const { POST } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const m = memberId("clerk_seeker");
    registerMember(m);
    const before = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(m) as {
        xp: number;
      }
    ).xp;

    const res = await POST(
      req("POST", { need: " designer ", skills: ["react", "node"] }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const { entry, created } = await res.json();
    expect(created).toBe(true);
    expect(entry.need).toBe("designer");
    expect(entry.skills).toEqual(["react", "node"]);

    const after = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(m) as {
        xp: number;
      }
    ).xp;
    expect(after - before).toBe(10);

    // re-anunciar = update, 200, sem XP de novo
    const res2 = await POST(req("POST", { need: "agora front" }), ctx());
    expect(res2.status).toBe(200);
    const j2 = await res2.json();
    expect(j2.created).toBe(false);
    expect(j2.entry.need).toBe("agora front");
    expect(j2.entry.skills).toEqual([]); // skills substituídas
    const after2 = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(m) as {
        xp: number;
      }
    ).xp;
    expect(after2).toBe(after);
  });

  it("403 — membro não inscrito na edição", async () => {
    const { POST } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    clerk.uid = "clerk_noreg";
    memberId("clerk_noreg"); // sem registration
    const res = await POST(req("POST", { need: "dados" }), ctx());
    expect(res.status).toBe(403);
    const { error } = await res.json();
    expect(error).toMatch(/inscreve/i);
  });

  it("401 — deslogado; clerkId sem member também 401", async () => {
    const { POST } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    clerk.uid = null;
    const anon = await POST(req("POST", { need: "x" }), ctx());
    expect(anon.status).toBe(401);

    clerk.uid = "ghost_sem_member";
    const ghost = await POST(req("POST", { need: "x" }), ctx());
    expect(ghost.status).toBe(401);
  });

  it("404 — edição inexistente", async () => {
    const { POST } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const m = memberId("clerk_seeker");
    registerMember(m);
    const res = await POST(req("POST", { need: "x" }), ctx("nao-existe"));
    expect(res.status).toBe(404);
  });

  it("400 — need ausente/longo, note longo, skills não-array", async () => {
    const { POST } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const m = memberId("clerk_seeker");
    registerMember(m);
    for (const body of [
      {},
      { need: "" },
      { need: "   " },
      { need: "x".repeat(201) },
      { need: "ok", note: "x".repeat(301) },
      { need: "ok", skills: "react" },
    ]) {
      const res = await POST(req("POST", body), ctx());
      expect(res.status).toBe(400);
    }
    expect(
      (
        db
          .prepare("SELECT COUNT(*) n FROM looking_for_team WHERE memberId = ?")
          .get(m) as { n: number }
      ).n,
    ).toBe(0);
  });
});

describe("DELETE /api/hackathons/[id]/team-board", () => {
  it("200 — desativa o próprio anúncio; idempotente", async () => {
    const { POST, GET, DELETE } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const m = memberId("clerk_seeker");
    registerMember(m);
    await POST(req("POST", { need: "dados" }), ctx());

    const res = await DELETE(req("DELETE"), ctx());
    expect(res.status).toBe(200);

    clerk.uid = null;
    const { entries } = await (await GET(req("GET"), ctx())).json();
    expect(entries).toHaveLength(0);

    clerk.uid = "clerk_seeker";
    const again = await DELETE(req("DELETE"), ctx());
    expect(again.status).toBe(200);
  });

  it("401 — deslogado", async () => {
    const { DELETE } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    clerk.uid = null;
    const res = await DELETE(req("DELETE"), ctx());
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/hackathons/[id]/team-board — moderação admin", () => {
  it("200 — admin desativa entry alheia; 403 não-admin; 404 entry de outra edição", async () => {
    const { POST, PATCH } = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const m = memberId("clerk_seeker");
    registerMember(m);
    const created = await (
      await POST(req("POST", { need: "dados" }), ctx())
    ).json();

    // não-admin → 403
    const forbidden = await PATCH(
      req("PATCH", { entryId: created.entry.id, active: false }),
      ctx(),
    );
    expect(forbidden.status).toBe(403);

    // admin → 200
    clerk.uid = "clerk_admin";
    memberId("clerk_admin", "admin");
    const ok = await PATCH(
      req("PATCH", { entryId: created.entry.id, active: false }),
      ctx(),
    );
    expect(ok.status).toBe(200);
    const { entry } = await ok.json();
    expect(entry.active).toBe(false);

    // entry de outra edição → 404
    const m2 = memberId("clerk_other");
    db.prepare(
      "INSERT INTO looking_for_team (memberId, hackathonId, need) VALUES (?, 'hack-inova-puc-saude-2026', 'x')",
    ).run(m2);
    const other = db
      .prepare(
        "SELECT id FROM looking_for_team WHERE hackathonId = 'hack-inova-puc-saude-2026'",
      )
      .get() as { id: number };
    const wrong = await PATCH(
      req("PATCH", { entryId: other.id, active: false }),
      ctx(),
    );
    expect(wrong.status).toBe(404);

    // validação → 400
    const bad = await PATCH(req("PATCH", { entryId: "x" }), ctx());
    expect(bad.status).toBe(400);
  });
});
