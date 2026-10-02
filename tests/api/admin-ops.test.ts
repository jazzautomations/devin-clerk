import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getHackathon } from "@/lib/hackathons";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_admin" })),
  currentUser: vi.fn(async () => null),
}));

const HID = "admin-ops-api-test";
const params = Promise.resolve({ id: HID });

beforeEach(() => {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_admin','admin_ops','a@t.dev','admin')",
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline, tags, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    HID,
    "Hack Ops",
    "Hack Inova",
    "2026-12-01T09:00:00-03:00",
    null,
    "online",
    null,
    `https://hackinova.vercel.app`,
    null,
    "[]",
  );
  db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(HID);
  db.prepare("DELETE FROM subscribers").run();
});

const req = (url: string, method: string, body?: unknown) =>
  new Request(`http://t${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("PATCH /api/admin/hackathons/[id]", () => {
  it("admin edita campos → 200 e persiste", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(
      req(`/api/admin/hackathons/${HID}`, "PATCH", {
        name: "Hack Ops Edição 2",
        location: "Sorocaba, SP",
        tags: ["ia", "comunidade"],
      }),
      { params },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hackathon.name).toBe("Hack Ops Edição 2");
    const h = getHackathon(HID)!;
    expect(h.location).toBe("Sorocaba, SP");
    expect(h.tags).toEqual(["ia", "comunidade"]);
    expect(h.organizer).toBe("Hack Inova"); // campo não enviado intacto
  });

  it("toggle active arquiva a edição", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(
      req(`/api/admin/hackathons/${HID}`, "PATCH", { active: false }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(getHackathon(HID)!.active).toBe(false);
  });

  it("400: format inválido, name vazio, patch vazio, tags não-array", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    for (const body of [
      { format: "vale-tudo" },
      { name: "  " },
      {},
      { tags: "ia,saude" },
      { active: "sim" },
    ]) {
      const res = await PATCH(req(`/api/admin/hackathons/${HID}`, "PATCH", body), {
        params,
      });
      expect(res.status).toBe(400);
    }
    // nada mudou
    expect(getHackathon(HID)!.name).toBe("Hack Ops");
  });

  it("404 edição inexistente", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(
      req("/api/admin/hackathons/fantasma", "PATCH", { name: "x" }),
      { params: Promise.resolve({ id: "fantasma" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/hackathons/[id]/registrations", () => {
  it("lista inscritos com username, name, email e createdAt", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO members (clerkId, username, name, email) VALUES ('c_insc','inscrito','Inscrito Silva','inscrito@t.dev')",
    ).run();
    const memberId = (
      db.prepare("SELECT id FROM members WHERE username = 'inscrito'").get() as {
        id: number;
      }
    ).id;
    db.prepare(
      "INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?)",
    ).run(memberId, HID);

    const { GET } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/route"
    );
    const res = await GET(req(`/api/admin/hackathons/${HID}/registrations`, "GET"), {
      params,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.registrations).toHaveLength(1);
    expect(data.registrations[0].username).toBe("inscrito");
    expect(data.registrations[0].name).toBe("Inscrito Silva");
    expect(data.registrations[0].email).toBe("inscrito@t.dev");
    expect(data.registrations[0].createdAt).toBeTruthy();
  });

  it("edição sem inscritos → 200 lista vazia; edição fantasma → 404", async () => {
    const { GET } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/route"
    );
    const empty = await GET(req(`/api/admin/hackathons/${HID}/registrations`, "GET"), {
      params,
    });
    expect(empty.status).toBe(200);
    expect((await empty.json()).registrations).toEqual([]);
    const nf = await GET(req("/api/admin/hackathons/fantasma/registrations", "GET"), {
      params: Promise.resolve({ id: "fantasma" }),
    });
    expect(nf.status).toBe(404);
  });
});

describe("GET /api/admin/subscribers", () => {
  it("retorna assinantes em JSON", async () => {
    db.prepare("INSERT INTO subscribers (email) VALUES ('jane@x.dev')").run();
    const { GET } = await import("@/app/api/admin/subscribers/route");
    const res = await GET(req("/api/admin/subscribers", "GET"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subscribers).toHaveLength(1);
    expect(data.subscribers[0].email).toBe("jane@x.dev");
    expect(data.subscribers[0].createdAt).toBeTruthy();
  });

  it("?format=csv retorna text/csv baixável com uma linha por assinante", async () => {
    db.prepare("INSERT INTO subscribers (email) VALUES ('jane@x.dev')").run();
    db.prepare("INSERT INTO subscribers (email) VALUES ('john@x.dev')").run();
    const { GET } = await import("@/app/api/admin/subscribers/route");
    const res = await GET(req("/api/admin/subscribers?format=csv", "GET"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    const lines = body.trim().split("\n");
    expect(lines[0]).toBe("email,createdAt");
    expect(lines).toHaveLength(3);
    expect(body).toContain("jane@x.dev");
    expect(body).toContain("john@x.dev");
  });
});
