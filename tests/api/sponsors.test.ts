import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import "@/lib/sponsors"; // schema próprio: sponsors + challenges.sponsorId

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_admin" })),
  currentUser: vi.fn(async () => null),
}));

const PUC = "hack-inova-puc-saude-2026";

beforeEach(() => {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_admin','admin_t','a@t.dev','admin')",
  ).run();
  db.prepare("DELETE FROM challenges WHERE id NOT LIKE 'seed-%'").run();
  db.prepare("UPDATE challenges SET sponsorId = NULL, active = 1").run();
  db.prepare("DELETE FROM sponsors").run();
});

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedSponsor(body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/sponsors/route");
  const res = await POST(req("POST", { name: "Oracle", ...body }));
  return res;
}

describe("POST /api/admin/sponsors", () => {
  it("admin cadastra sponsor completo → 201", async () => {
    const res = await seedSponsor({
      url: "https://oracle.com",
      tier: "master",
      contactEmail: "devrel@oracle.com",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sponsor.name).toBe("Oracle");
    expect(data.sponsor.tier).toBe("master");
    expect(data.sponsor.active).toBe(true);
  });

  it("tier default é 'sponsor'", async () => {
    const res = await seedSponsor();
    const data = await res.json();
    expect(data.sponsor.tier).toBe("sponsor");
  });

  it("400 sem name, name vazio, tier inválido ou nome duplicado", async () => {
    const { POST } = await import("@/app/api/admin/sponsors/route");
    expect((await POST(req("POST", {}))).status).toBe(400);
    expect((await POST(req("POST", { name: "  " }))).status).toBe(400);
    expect(
      (await POST(req("POST", { name: "X", tier: "diamante" }))).status,
    ).toBe(400);
    expect((await POST(req("POST"))).status).toBe(400);
    await seedSponsor();
    expect((await seedSponsor()).status).toBe(400); // UNIQUE
  });
});

describe("GET /api/admin/sponsors", () => {
  it("lista sponsors com contagem de desafios vinculados", async () => {
    const created = await (await seedSponsor()).json();
    const { POST: postChallenge } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    await postChallenge(
      req("POST", { title: "T", sponsorId: created.sponsor.id }),
      params(PUC),
    );
    const { GET } = await import("@/app/api/admin/sponsors/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    const s = data.sponsors.find(
      (x: { id: string }) => x.id === created.sponsor.id,
    );
    expect(s.name).toBe("Oracle");
    expect(s.challengeCount).toBe(1);
  });
});

describe("PATCH /api/admin/sponsors/[id]", () => {
  it("edita campos e desativa → 200", async () => {
    const id = (await (await seedSponsor()).json()).sponsor.id as string;
    const { PATCH } = await import("@/app/api/admin/sponsors/[id]/route");
    const res = await PATCH(
      req("PATCH", { tier: "master", url: null, active: false }),
      params(id),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sponsor.tier).toBe("master");
    expect(data.sponsor.url).toBeNull();
    expect(data.sponsor.active).toBe(false);
  });

  it("404 inexistente; 400 body vazio ou campo inválido", async () => {
    const id = (await (await seedSponsor()).json()).sponsor.id as string;
    const { PATCH } = await import("@/app/api/admin/sponsors/[id]/route");
    expect(
      (await PATCH(req("PATCH", { name: "x" }), params("fantasma"))).status,
    ).toBe(404);
    expect((await PATCH(req("PATCH", {}), params(id))).status).toBe(400);
    expect(
      (await PATCH(req("PATCH", { tier: "x" }), params(id))).status,
    ).toBe(400);
    expect(
      (await PATCH(req("PATCH", { name: " " }), params(id))).status,
    ).toBe(400);
    expect(
      (await PATCH(req("PATCH", { active: "sim" }), params(id))).status,
    ).toBe(400);
  });
});

describe("challenges ⋈ sponsors — sponsorId na API de desafios", () => {
  it("POST desafio com sponsorId vincula e resposta expõe url+tier", async () => {
    const s = (await (
      await seedSponsor({ url: "https://oracle.com", tier: "master" })
    ).json()).sponsor;
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const res = await POST(
      req("POST", { title: "Jornada X", sponsorId: s.id }),
      params(PUC),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.challenge.sponsorId).toBe(s.id);
    expect(data.challenge.sponsor).toBe("Oracle"); // nome da entidade como display
    expect(data.challenge.sponsorUrl).toBe("https://oracle.com");
    expect(data.challenge.sponsorTier).toBe("master");
  });

  it("400 com sponsorId inexistente e sem sponsor nem sponsorId", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    expect(
      (
        await POST(
          req("POST", { title: "T", sponsorId: "fantasma" }),
          params(PUC),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(req("POST", { title: "T" }), params(PUC))).status,
    ).toBe(400);
  });

  it("PATCH desafio: sponsorId vincula e null desvincula → 200/400", async () => {
    const s = (await (await seedSponsor()).json()).sponsor;
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const created = await (
      await POST(req("POST", { sponsor: "Legado", title: "T" }), params(PUC))
    ).json();
    const { PATCH } = await import(
      "@/app/api/admin/challenges/[challengeId]/route"
    );
    const chParams = {
      params: Promise.resolve({ challengeId: created.challenge.id }),
    };
    const linked = await PATCH(req("PATCH", { sponsorId: s.id }), chParams);
    expect(linked.status).toBe(200);
    expect((await linked.json()).challenge.sponsorId).toBe(s.id);
    const unlinked = await PATCH(req("PATCH", { sponsorId: null }), chParams);
    expect(unlinked.status).toBe(200);
    expect((await unlinked.json()).challenge.sponsorId).toBeNull();
    expect(
      (
        await PATCH(req("PATCH", { sponsorId: "fantasma" }), chParams)
      ).status,
    ).toBe(400);
  });
});
