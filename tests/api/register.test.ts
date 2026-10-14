import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_api_1" })),
  currentUser: vi.fn(async () => ({
    firstName: "Test",
    lastName: null,
    primaryEmailAddress: { emailAddress: "api1@t.dev" },
  })),
}));

const HACK_ID = "hack-inova-alphaville-2026";

async function makeMember() {
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run("clerk_api_1", "api1", "api1@t.dev");
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get("clerk_api_1") as {
      id: number;
    }
  ).id;
}

const params = Promise.resolve({ id: HACK_ID });
// spec 033 — o aceite LGPD é obrigatório na inscrição
const consentReq = () =>
  new Request("http://t", { method: "POST", body: JSON.stringify({ consent: true, terms: { birthDate: "2000-01-01", conduct: true } }) });

describe("POST /api/hackathons/[id]/register — BDD do reward", () => {
  beforeEach(async () => {
    await db.prepare("DELETE FROM registrations").run();
    await db.prepare("DELETE FROM member_cards").run();
    await db.prepare("DELETE FROM member_badges").run();
    await makeMember();
  });

  it("inscreve, paga +50xp, minta a carta №001 e concede badges", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(consentReq(), {
      params,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.registered).toBe(true);
    expect(data.xp).toBe("+50");
    expect(data.cardSerial).toBe(1);
    expect(data.newBadges).toContain("debut");
    expect(data.newBadges).toContain("pioneiro");
  });

  it("DELETE cancela a inscrição", async () => {
    const { POST, DELETE } = await import(
      "@/app/api/hackathons/[id]/register/route"
    );
    await POST(consentReq(), { params });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), {
      params,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.registered).toBe(false);
  });

  it("404 num hackathon que não existe", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(consentReq(), {
      params: Promise.resolve({ id: "nao-existe" }),
    });
    expect(res.status).toBe(404);
  });

  it("lista pública (frente N #6): POST sem opt-in não lista; publicListing:true lista; PATCH liga/desliga", async () => {
    const route = await import("@/app/api/hackathons/[id]/register/route");
    const mid = await makeMember();
    const listed = async () =>
      (await db.prepare("SELECT publicListing FROM registrations WHERE memberId = ? AND hackathonId = ?").get<{
        publicListing: number;
      }>(mid, HACK_ID))?.publicListing;

    const patch = (body: unknown) =>
      route.PATCH(new Request("http://t", { method: "PATCH", body: JSON.stringify(body) }), { params });
    expect((await patch({ publicListing: true })).status).toBe(404); // sem inscrição

    await route.POST(consentReq(), { params });
    expect(await listed()).toBe(0);
    expect((await patch({ publicListing: "sim" })).status).toBe(400);
    const on = await patch({ publicListing: true });
    expect(on.status).toBe(200);
    expect(await listed()).toBe(1);
    const st = await (await route.GET(new Request("http://t"), { params })).json();
    expect(st).toEqual({ status: "approved", publicListing: true });
    await patch({ publicListing: false });
    expect(await listed()).toBe(0);

    await db.prepare("DELETE FROM registrations").run();
    await route.POST(
      new Request("http://t", { method: "POST", body: JSON.stringify({ consent: true, publicListing: true }) }),
      { params },
    );
    expect(await listed()).toBe(1);
  });
});

describe("POST /api/posts — recompensa de criação", () => {
  it("cria post e paga +10xp; rejeita post vazio e link inválido", async () => {
    await makeMember();
    const { POST } = await import("@/app/api/posts/route");
    const ok = await POST(
      new Request("http://t", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "minha demo", link: "https://d.dev" }),
      }),
    );
    expect(ok.status).toBe(201);
    const { post } = await ok.json();
    expect(post.link).toBe("https://d.dev");

    const empty = await POST(
      new Request("http://t", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "  " }),
      }),
    );
    expect(empty.status).toBe(400);

    const badLink = await POST(
      new Request("http://t", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "oi", link: "ftp://x" }),
      }),
    );
    expect(badLink.status).toBe(400);
  });
});
