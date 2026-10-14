import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { ticketToken, listCheckins } from "@/lib/checkins";
import { getEditionRoles, grantEditionRole, listPendingInvites } from "@/lib/roles";

// spec 033 US4 (check-in) + US7 (equipe da edição) — guardas e contrato.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => null),
}));

type AuthResult = Awaited<ReturnType<typeof auth>>;
const asUser = (id: string | null) =>
  vi.mocked(auth).mockResolvedValue({ userId: id } as AuthResult);

const H = "hack-inova-alphaville-2026";
const OTHER = "hack-inova-unifacens-2026";

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function idOf(clerkId: string) {
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerkId))!.id;
}

async function reg(clerkId: string, hackathonId: string, status: string) {
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(await idOf(clerkId), hackathonId, status);
  return (await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(await idOf(clerkId), hackathonId))!.id;
}

beforeEach(async () => {
  for (const [c, u] of [
    ["clerk_org", "org_033"],
    ["clerk_staff", "staff_033"],
    ["clerk_mentor", "mentor_033"],
    ["clerk_part", "part_033"],
    ["clerk_part2", "part2_033"],
  ]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
      .run(c, u, `${u}@t.dev`, u.toUpperCase());
  }
  await db.prepare("DELETE FROM checkins").run();
  await db.prepare("DELETE FROM registrations").run();
  await db.prepare("DELETE FROM edition_roles").run();
  await db.prepare("DELETE FROM edition_role_invites").run();
  // check-in só vale na janela do evento: a edição acontece hoje
  const today = new Date().toISOString();
  await db.prepare("UPDATE hackathons SET startsAt = ?, endsAt = ? WHERE id = ?").run(today, today, H);
  await grantEditionRole(H, await idOf("clerk_org"), "organizador", null);
  await grantEditionRole(H, await idOf("clerk_staff"), "staff", null);
  await grantEditionRole(H, await idOf("clerk_mentor"), "mentor", null);
});

describe("POST /api/admin/hackathons/[id]/checkin", () => {
  const route = () => import("@/app/api/admin/hackathons/[id]/checkin/route");

  it("deslogado → 401; sem papel de staff → 403; edição fantasma → 404", async () => {
    const { POST } = await route();
    asUser(null);
    expect((await POST(req("POST", { token: "x" }), params(H))).status).toBe(401);
    asUser("clerk_mentor");
    expect((await POST(req("POST", { token: "x" }), params(H))).status).toBe(403);
    asUser("clerk_staff");
    expect((await POST(req("POST", { token: "x" }), params(OTHER))).status).toBe(403);
    expect((await POST(req("POST", { token: "x" }), params("fantasma"))).status).toBe(404);
  });

  it("staff lê o QR → 200; segunda leitura → 200 'já fez check-in às HH:MM' sem duplicar", async () => {
    const rid = await reg("clerk_part", H, "approved");
    const { POST } = await route();
    asUser("clerk_staff");
    const first = await POST(req("POST", { token: ticketToken(rid) }), params(H));
    expect(first.status).toBe(200);
    const d1 = await first.json();
    expect(d1).toMatchObject({ already: false, username: "part_033" });
    expect(d1.message).toMatch(/check-in feito/i);

    const second = await POST(req("POST", { token: ticketToken(rid) }), params(H));
    expect(second.status).toBe(200);
    const d2 = await second.json();
    expect(d2.already).toBe(true);
    expect(d2.message).toMatch(/já fez check-in às \d{2}:\d{2}/);
    expect(d2.counts).toEqual({ inscritos: 1, aprovados: 1, presentes: 1 });
    expect((await listCheckins(H)).length).toBe(1);
  });

  it("organizador marca pela busca manual (registrationId)", async () => {
    const rid = await reg("clerk_part", H, "approved");
    const { POST } = await route();
    asUser("clerk_org");
    const res = await POST(req("POST", { registrationId: rid }), params(H));
    expect(res.status).toBe(200);
  });

  it("forjado/outra edição → 404; malformado ou corpo vazio → 400", async () => {
    const rid = await reg("clerk_part", OTHER, "approved");
    const { POST } = await route();
    asUser("clerk_staff");
    expect((await POST(req("POST", { token: ticketToken(rid) }), params(H))).status).toBe(404);
    expect((await POST(req("POST", { token: "HH1." + "Z".repeat(43) }), params(H))).status).toBe(404);
    expect((await POST(req("POST", { token: "nada" }), params(H))).status).toBe(400);
    expect((await POST(req("POST", {}), params(H))).status).toBe(400);
    expect((await POST(req("POST", { registrationId: "1; drop" }), params(H))).status).toBe(400);
  });

  it("pendente/rejeitado → 409 com mensagem clara", async () => {
    const p = await reg("clerk_part", H, "pending");
    const r = await reg("clerk_part2", H, "rejected");
    const { POST } = await route();
    asUser("clerk_staff");
    const rp = await POST(req("POST", { token: ticketToken(p) }), params(H));
    expect(rp.status).toBe(409);
    expect((await rp.json()).error).toMatch(/pendente/i);
    const rr = await POST(req("POST", { registrationId: r }), params(H));
    expect(rr.status).toBe(409);
    expect((await rr.json()).error).toMatch(/recusad/i);
  });

  it("GET ?q= busca inscritos e devolve o contador (staff only)", async () => {
    await reg("clerk_part", H, "approved");
    const { GET } = await route();
    asUser("clerk_staff");
    const res = await GET(new Request("http://t/?q=part_0"), params(H));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.results.map((r: { username: string }) => r.username)).toEqual(["part_033"]);
    expect(d.counts).toEqual({ inscritos: 1, aprovados: 1, presentes: 0 });
    asUser("clerk_part");
    expect((await GET(new Request("http://t/?q=x"), params(H))).status).toBe(403);
  });
});

describe("/api/admin/hackathons/[id]/roles — equipe da edição", () => {
  const route = () => import("@/app/api/admin/hackathons/[id]/roles/route");

  it("deslogado → 401; staff (não organizador) → 403", async () => {
    const { GET, POST, DELETE } = await route();
    asUser(null);
    expect((await GET(req("GET"), params(H))).status).toBe(401);
    expect((await POST(req("POST", { email: "a@t.dev", role: "staff" }), params(H))).status).toBe(401);
    expect((await DELETE(req("DELETE", { memberId: 1, role: "staff" }), params(H))).status).toBe(401);
    asUser("clerk_staff");
    expect((await GET(req("GET"), params(H))).status).toBe(403);
    expect((await POST(req("POST", { email: "a@t.dev", role: "staff" }), params(H))).status).toBe(403);
    expect((await DELETE(req("DELETE", { memberId: 1, role: "staff" }), params(H))).status).toBe(403);
  });

  it("organizador lista time e convites", async () => {
    const { GET } = await route();
    asUser("clerk_org");
    const res = await GET(req("GET"), params(H));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.team.map((t: { username: string }) => t.username).sort()).toEqual(
      ["mentor_033", "org_033", "staff_033"],
    );
    expect(d.invites).toEqual([]);
  });

  it("convite: e-mail com conta vira papel; sem conta fica pendente; inválido → 400", async () => {
    const { POST } = await route();
    asUser("clerk_org");
    const g = await POST(req("POST", { email: "PART_033@t.dev", role: "jurado" }), params(H));
    expect(g.status).toBe(201);
    expect((await g.json()).result).toBe("granted");
    expect(await getEditionRoles(H, await idOf("clerk_part"))).toEqual(["jurado"]);

    const p = await POST(req("POST", { email: "nova@t.dev", role: "mentor" }), params(H));
    expect(p.status).toBe(201);
    expect((await p.json()).result).toBe("pending");
    expect((await listPendingInvites(H)).map((i) => i.email)).toEqual(["nova@t.dev"]);

    expect((await POST(req("POST", { email: "nao-email", role: "staff" }), params(H))).status).toBe(400);
    expect((await POST(req("POST", { email: "x@t.dev", role: "rei" }), params(H))).status).toBe(400);
    expect((await POST(req("POST", null), params(H))).status).toBe(400);
  });

  it("remove papel e cancela convite pendente", async () => {
    const { POST, DELETE } = await route();
    asUser("clerk_org");
    const staffId = await idOf("clerk_staff");
    const res = await DELETE(req("DELETE", { memberId: staffId, role: "staff" }), params(H));
    expect(res.status).toBe(200);
    expect(await getEditionRoles(H, staffId)).toEqual([]);

    await POST(req("POST", { email: "pend@t.dev", role: "staff" }), params(H));
    const del = await DELETE(req("DELETE", { email: "pend@t.dev", role: "staff" }), params(H));
    expect(del.status).toBe(200);
    expect(await listPendingInvites(H)).toEqual([]);

    expect((await DELETE(req("DELETE", { memberId: "x", role: "staff" }), params(H))).status).toBe(400);
    expect((await DELETE(req("DELETE", { memberId: staffId, role: "rei" }), params(H))).status).toBe(400);
  });

  it("organizador não remove o próprio papel de organizador (evita edição órfã)", async () => {
    const { DELETE } = await route();
    asUser("clerk_org");
    const orgId = await idOf("clerk_org");
    const res = await DELETE(req("DELETE", { memberId: orgId, role: "organizador" }), params(H));
    expect(res.status).toBe(400);
    expect(await getEditionRoles(H, orgId)).toEqual(["organizador"]);
  });

  it("organizador de outra edição → 403 aqui", async () => {
    const { GET } = await route();
    asUser("clerk_org");
    expect((await GET(req("GET"), params(OTHER))).status).toBe(403);
  });
});
