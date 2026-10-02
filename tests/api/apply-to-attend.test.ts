import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getRegistrationStatus } from "@/lib/registrations";
import { getHackathon } from "@/lib/hackathons";
import { getMemberCard } from "@/lib/xp";
import { auth } from "@clerk/nextjs/server";

// spec 032 — "pedir lugar": edição curada (requiresApproval) transforma o
// register em pedido pendente; a recompensa só cai na aprovação admin.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => null),
}));

type AuthResult = Awaited<ReturnType<typeof auth>>;
const asUser = (id: string | null) =>
  vi.mocked(auth).mockResolvedValue({ userId: id } as AuthResult);

const CURATED = "curada-api";
const OPEN = "hack-inova-alphaville-2026";

function memberIdOf(clerkId: string): number {
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const xpOf = (id: number) =>
  (db.prepare("SELECT xp FROM members WHERE id = ?").get(id) as { xp: number })
    .xp;

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const regParams = (id: string) => Promise.resolve({ id });
const reviewParams = (id: string, memberId: number | string) =>
  Promise.resolve({ id, memberId: String(memberId) });

beforeEach(() => {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_adm','adm_032','adm@t.dev','admin')",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES ('clerk_usr','usr_032','usr@t.dev')",
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl, tags, requiresApproval)
     VALUES (?, 'Curada API', 'Hack Inova', '2099-06-01', 'online',
             'https://x.dev', '[]', 1)`,
  ).run(CURATED);
  db.prepare("UPDATE hackathons SET requiresApproval = 1 WHERE id = ?").run(
    CURATED,
  );
  db.prepare("UPDATE hackathons SET requiresApproval = 0 WHERE id = ?").run(
    OPEN,
  );
  db.prepare("DELETE FROM registrations WHERE hackathonId IN (?, ?)").run(
    CURATED,
    OPEN,
  );
  db.prepare("DELETE FROM member_cards WHERE hackathonId IN (?, ?)").run(
    CURATED,
    OPEN,
  );
  // XP/badges acumulam por membro entre testes do mesmo banco — zera pra
  // cada caso afirmar a recompensa exata do fluxo
  db.prepare("UPDATE members SET xp = 0").run();
  db.prepare("DELETE FROM member_badges").run();
});

describe("POST /api/hackathons/[id]/register — edição curada", () => {
  it("pedido novo → 201 {status:'pending'} SEM recompensa", async () => {
    asUser("clerk_usr");
    const { POST } = await import(
      "@/app/api/hackathons/[id]/register/route"
    );
    const res = await POST(req("POST"), { params: regParams(CURATED) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("pending");
    expect(data.registered).toBe(false);
    const mid = memberIdOf("clerk_usr");
    expect(getRegistrationStatus(mid, CURATED)).toBe("pending");
    expect(getMemberCard(mid, CURATED)).toBeNull();
    expect(xpOf(mid)).toBe(0);
  });

  it("re-POST pendente → 200 idempotente (não duplica nem promove)", async () => {
    asUser("clerk_usr");
    const { POST } = await import(
      "@/app/api/hackathons/[id]/register/route"
    );
    await POST(req("POST"), { params: regParams(CURATED) });
    const res = await POST(req("POST"), { params: regParams(CURATED) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");
  });

  it("edição aberta → 200 {status:'approved'} com xp/carta/badges (contrato antigo + status)", async () => {
    asUser("clerk_usr");
    const { POST } = await import(
      "@/app/api/hackathons/[id]/register/route"
    );
    const res = await POST(req("POST"), { params: regParams(OPEN) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.registered).toBe(true);
    expect(data.status).toBe("approved");
    expect(data.xp).toBe("+50");
    expect(data.cardSerial).toBeGreaterThan(0);
  });

  it("GET devolve o status do membro; anon → 401 JSON", async () => {
    asUser("clerk_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST"), { params: regParams(CURATED) });
    const res = await reg.GET(req("GET"), { params: regParams(CURATED) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending");

    asUser(null);
    const anon = await reg.GET(req("GET"), { params: regParams(CURATED) });
    expect(anon.status).toBe(401);
  });

  it("DELETE cancela o pedido pendente (a linha some)", async () => {
    asUser("clerk_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST"), { params: regParams(CURATED) });
    const res = await reg.DELETE(req("DELETE"), { params: regParams(CURATED) });
    expect(res.status).toBe(200);
    expect(
      getRegistrationStatus(memberIdOf("clerk_usr"), CURATED),
    ).toBeNull();
  });
});

describe("PATCH /api/admin/hackathons/[id]/registrations/[memberId]", () => {
  it("admin aprova → 200, status approved e recompensa completa", async () => {
    asUser("clerk_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST"), { params: regParams(CURATED) });
    const mid = memberIdOf("clerk_usr");

    asUser("clerk_adm");
    const { PATCH } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/[memberId]/route"
    );
    const res = await PATCH(req("PATCH", { action: "approve" }), {
      params: reviewParams(CURATED, mid),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.rewarded).toBe(true);
    expect(data.cardSerial).toBeGreaterThan(0);
    expect(getRegistrationStatus(mid, CURATED)).toBe("approved");
    expect(xpOf(mid)).toBe(50);
    expect(getMemberCard(mid, CURATED)).not.toBeNull();
  });

  it("admin recusa → 200 {status:'rejected'}; memberId sem inscrição → 404", async () => {
    asUser("clerk_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST"), { params: regParams(CURATED) });
    const mid = memberIdOf("clerk_usr");

    asUser("clerk_adm");
    const { PATCH } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/[memberId]/route"
    );
    const res = await PATCH(req("PATCH", { action: "reject" }), {
      params: reviewParams(CURATED, mid),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("rejected");
    expect(getRegistrationStatus(mid, CURATED)).toBe("rejected");
    // já decidido → ainda existe a linha; membro sem inscrição → 404
    const nf = await PATCH(req("PATCH", { action: "approve" }), {
      params: reviewParams(CURATED, 999999),
    });
    expect(nf.status).toBe(404);
    const badId = await PATCH(req("PATCH", { action: "approve" }), {
      params: reviewParams(CURATED, "abc"),
    });
    expect(badId.status).toBe(404);
  });

  it("action inválida → 400; edição fantasma → 404", async () => {
    asUser("clerk_adm");
    const { PATCH } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/[memberId]/route"
    );
    const bad = await PATCH(req("PATCH", { action: "talvez" }), {
      params: reviewParams(CURATED, 1),
    });
    expect(bad.status).toBe(400);
    const nf = await PATCH(req("PATCH", { action: "approve" }), {
      params: reviewParams("fantasma", 1),
    });
    expect(nf.status).toBe(404);
  });

  it("não-admin → 403; deslogado → 401", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/[memberId]/route"
    );
    asUser("clerk_usr");
    expect(
      (
        await PATCH(req("PATCH", { action: "approve" }), {
          params: reviewParams(CURATED, 1),
        })
      ).status,
    ).toBe(403);
    asUser(null);
    expect(
      (
        await PATCH(req("PATCH", { action: "approve" }), {
          params: reviewParams(CURATED, 1),
        })
      ).status,
    ).toBe(401);
  });
});

describe("PATCH /api/admin/hackathons/[id] — flag requiresApproval", () => {
  it("admin liga a flag → 200 e persiste; não-booleano → 400", async () => {
    asUser("clerk_adm");
    expect(getHackathon(OPEN)!.requiresApproval).toBe(false);
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(req("PATCH", { requiresApproval: true }), {
      params: regParams(OPEN),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).hackathon.requiresApproval).toBe(true);
    expect(getHackathon(OPEN)!.requiresApproval).toBe(true);
    const bad = await PATCH(req("PATCH", { requiresApproval: "sim" }), {
      params: regParams(OPEN),
    });
    expect(bad.status).toBe(400);
  });
});

describe("gates tratam pendente como não-inscrito", () => {
  it("team, team-board e mural (posts c/ hackathonId) → 403 pra pendente", async () => {
    asUser("clerk_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST"), { params: regParams(CURATED) }); // pending

    const team = await import("@/app/api/hackathons/[id]/team/route");
    const t = await team.POST(req("POST", { name: "Time X" }), {
      params: regParams(CURATED),
    });
    expect(t.status).toBe(403);

    const board = await import(
      "@/app/api/hackathons/[id]/team-board/route"
    );
    const b = await board.POST(req("POST", { need: "backend" }), {
      params: regParams(CURATED),
    });
    expect(b.status).toBe(403);

    const posts = await import("@/app/api/posts/route");
    const p = await posts.POST(
      req("POST", { body: "oi mural", hackathonId: CURATED }),
    );
    expect(p.status).toBe(403);
  });
});
