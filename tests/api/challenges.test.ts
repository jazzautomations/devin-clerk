import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

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
});

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("POST /api/admin/hackathons/[id]/challenges", () => {
  it("admin cadastra desafio completo → 201", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const res = await POST(
      req("POST", {
        sponsor: "Oracle",
        title: "Jornada do paciente",
        description: "7 desafios da jornada",
        prize: "créditos OCI",
      }),
      { params: Promise.resolve({ id: PUC }) },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.challenge.sponsor).toBe("Oracle");
    expect(data.challenge.hackathonId).toBe(PUC);
    expect(data.challenge.active).toBe(true);
  });

  it("400 sem sponsor ou sem title", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const p = { params: Promise.resolve({ id: PUC }) };
    expect(
      (await POST(req("POST", { title: "só título" }), p)).status,
    ).toBe(400);
    expect(
      (await POST(req("POST", { sponsor: "só marca" }), p)).status,
    ).toBe(400);
    expect(
      (await POST(req("POST", { sponsor: "  ", title: "x" }), p)).status,
    ).toBe(400);
    expect((await POST(req("POST"), p)).status).toBe(400);
  });

  it("404 edição inexistente", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const res = await POST(req("POST", { sponsor: "S", title: "T" }), {
      params: Promise.resolve({ id: "fantasma" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/challenges/[challengeId]", () => {
  async function seedOne(): Promise<string> {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const res = await POST(req("POST", { sponsor: "S", title: "T" }), {
      params: Promise.resolve({ id: PUC }),
    });
    const data = await res.json();
    return data.challenge.id as string;
  }

  it("edita campos e desativa → 200", async () => {
    const id = await seedOne();
    const { PATCH } = await import(
      "@/app/api/admin/challenges/[challengeId]/route"
    );
    const res = await PATCH(
      req("PATCH", { prize: "R$5k", active: false }),
      { params: Promise.resolve({ challengeId: id }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.challenge.prize).toBe("R$5k");
    expect(data.challenge.active).toBe(false);
    // saiu da listagem pública mas não foi apagado
    const row = db
      .prepare("SELECT active FROM challenges WHERE id = ?")
      .get(id) as { active: number };
    expect(row.active).toBe(0);
  });

  it("404 desafio inexistente; 400 body vazio ou campo inválido", async () => {
    const id = await seedOne();
    const { PATCH } = await import(
      "@/app/api/admin/challenges/[challengeId]/route"
    );
    expect(
      (
        await PATCH(req("PATCH", { title: "x" }), {
          params: Promise.resolve({ challengeId: "fantasma" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await PATCH(req("PATCH", {}), {
          params: Promise.resolve({ challengeId: id }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await PATCH(req("PATCH", { sponsor: "  " }), {
          params: Promise.resolve({ challengeId: id }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await PATCH(req("PATCH", { active: "sim" }), {
          params: Promise.resolve({ challengeId: id }),
        })
      ).status,
    ).toBe(400);
  });
});
