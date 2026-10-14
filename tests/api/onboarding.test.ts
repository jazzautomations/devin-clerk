import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import db from "@/lib/db";

const clerk = vi.hoisted(() => ({ uid: "clerk_onb" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const patch = (body: unknown) =>
  new Request("http://t/api/onboarding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

type Row = {
  onboardedAt: string | null;
  intents: string;
  personas: string;
  persona: string | null;
  name: string | null;
  city: string | null;
  institution: string | null;
  course: string | null;
  github: string | null;
  linkedin: string | null;
  openTo: string | null;
};
const row = async () =>
  (await db.prepare("SELECT * FROM members WHERE clerkId = 'clerk_onb'").get<Row>())!;

describe("PATCH /api/onboarding (spec 039)", () => {
  it("401 sem sessão", async () => {
    const { PATCH } = await import("@/app/api/onboarding/route");
    clerk.uid = null;
    expect((await PATCH(patch({ intents: ["participar"] }))).status).toBe(401);
    clerk.uid = "clerk_onb";
  });

  it("valida tudo antes de gravar: 400 não salva nada pela metade", async () => {
    const { PATCH } = await import("@/app/api/onboarding/route");
    await db.prepare("INSERT INTO members (clerkId, username, name, email) VALUES ('clerk_onb', 'bia_onb', 'Bia', 'bia@t.dev')").run();
    expect((await PATCH(patch("nao é json"))).status).toBe(400);
    expect((await PATCH(patch({ intents: ["hackear"] }))).status).toBe(400);
    expect((await PATCH(patch({ personas: ["dev", "design", "produto", "dados", "mentor"] }))).status).toBe(400);
    expect((await PATCH(patch({ city: "x".repeat(61) }))).status).toBe(400);
    expect((await PATCH(patch({ github: "https://gitlab.com/bia" }))).status).toBe(400);
    expect((await PATCH(patch({ openTo: ["festa"] }))).status).toBe(400);
    expect((await PATCH(patch({ intents: ["participar"], city: 3 }))).status).toBe(400);
    const r = await row();
    expect(r.intents).toBe("[]");
    expect(r.onboardedAt).toBeNull();
  });

  it("grava cada passo e só o finish marca onboardedAt + cookie", async () => {
    const { PATCH } = await import("@/app/api/onboarding/route");
    const s1 = await PATCH(patch({ personas: ["dev", "estudante"], intents: ["participar", "mentorar"] }));
    expect(s1.status).toBe(200);
    expect(s1.headers.get("set-cookie")).toBeNull();
    const s2 = await PATCH(patch({ name: "  Bia   Souza ", headline: "dev front", city: "Sorocaba, SP", institution: "UniFacens", course: "" }));
    expect(s2.status).toBe(200);
    const s3 = await PATCH(patch({ github: "github.com/bia-dev", linkedin: "", openTo: ["trampo"], finish: true }));
    expect(s3.status).toBe(200);
    expect(s3.headers.get("set-cookie")).toMatch(/^hh_onb=clerk_onb;.*HttpOnly/);
    const r = await row();
    expect(JSON.parse(r.personas)).toEqual(["dev", "estudante"]);
    expect(r.persona).toBe("dev");
    expect(JSON.parse(r.intents)).toEqual(["participar", "mentorar"]);
    expect(r.name).toBe("Bia Souza");
    expect(r.city).toBe("Sorocaba, SP");
    expect(r.institution).toBe("UniFacens");
    expect(r.course).toBeNull();
    expect(r.github).toBe("bia-dev");
    expect(r.linkedin).toBeNull();
    expect(r.openTo).toBe("trampo");
    expect(r.onboardedAt).not.toBeNull();
  });

  it("nome vazio não apaga o nome; pular de novo não muda a data", async () => {
    const { PATCH } = await import("@/app/api/onboarding/route");
    const before = (await row()).onboardedAt;
    expect((await PATCH(patch({ name: "   ", finish: true }))).status).toBe(200);
    const r = await row();
    expect(r.name).toBe("Bia Souza");
    expect(r.onboardedAt).toBe(before);
  });
});

describe("migration 018 — membro antigo não é forçado", () => {
  it("o backfill marca onboardedAt de quem já existe", async () => {
    await db.prepare("INSERT INTO members (clerkId, username, email) VALUES ('clerk_old', 'antigo', 'old@t.dev')").run();
    // novo membro nasce sem onboardedAt; o UPDATE da migration é o mesmo
    // que rodou no deploy pra todo mundo que já tinha conta
    expect((await db.prepare("SELECT onboardedAt FROM members WHERE clerkId = 'clerk_old'").get<{ onboardedAt: string | null }>())!.onboardedAt).toBeNull();
    const sql = readFileSync(join(process.cwd(), "migrations/018_lead_organizar_onboarding.sql"), "utf8");
    const backfill = sql.split(";").map((x) => x.replace(/--.*$/gm, "").trim()).find((x) => x.startsWith("UPDATE members"));
    expect(backfill).toBeTruthy();
    await db.exec(backfill!);
    expect((await db.prepare("SELECT onboardedAt FROM members WHERE clerkId = 'clerk_old'").get<{ onboardedAt: string | null }>())!.onboardedAt).not.toBeNull();
  });
});
