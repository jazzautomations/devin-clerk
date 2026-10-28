import { afterEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { EVIDENCE_MIN_CHECKINS } from "@/lib/evidence";

// POST /api/cron/xp (spec 046, nivel-por-entrega): recalcula members.xp pelos
// fatos verificados. Sem o segredo do cron: 401 (aceite 4).

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
async function member(): Promise<{ id: number; username: string }> {
  const t = `xc${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`);
  return { id: r!.id, username: `u_${t}` };
}
async function checkin(memberId: number, hackathonId: string) {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(memberId, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, '2025-03-01 12:00:00')").run(r!.id);
}

const call = (headers: Record<string, string> = {}) =>
  new Request("http://t/api/cron/xp", { method: "POST", headers });
const xpOf = async (id: number) => (await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(id))!.xp;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cron/xp", () => {
  it("401 sem segredo, com segredo errado e com a env vazia", async () => {
    const { POST } = await import("@/app/api/cron/xp/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "segredo-cron");
    const sem = await POST(call());
    expect(sem.status).toBe(401);
    expect(await sem.json()).toEqual({ error: "Unauthorized" });
    expect((await POST(call({ Authorization: "Bearer outro" }))).status).toBe(401);
    vi.stubEnv("HACKAHUB_CRON_SECRET", "");
    expect((await POST(call({ Authorization: "Bearer " }))).status).toBe(401);
  });

  it("200 recalcula pelos fatos e a segunda passada não muda nada", async () => {
    const { POST } = await import("@/app/api/cron/xp/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "segredo-cron");
    const h = "xc-ed";
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source, publishedAt)
         VALUES (?, 'Hack XC', 'Org', '2025-03-01T09:00:00-03:00', '2025-03-02T18:00:00-03:00', 'presencial', '', '[]', 1, 'painel', '2025-01-01 00:00:00')`,
      )
      .run(h);
    for (let i = 0; i < EVIDENCE_MIN_CHECKINS; i++) await checkin((await member()).id, h);
    const ana = await member();
    await checkin(ana.id, h);
    const farm = await member();
    await db.prepare("UPDATE members SET xp = 640 WHERE id IN (?, ?)").run(ana.id, farm.id);

    const auth = { Authorization: "Bearer segredo-cron" };
    const r1 = await POST(call(auth));
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { updated: number; scanned: number };
    expect(b1.updated).toBeGreaterThanOrEqual(2);
    expect(b1.scanned).toBeGreaterThanOrEqual(EVIDENCE_MIN_CHECKINS + 1);
    expect(await xpOf(ana.id)).toBe(30);
    expect(await xpOf(farm.id)).toBe(0);

    const r2 = await POST(call(auth));
    expect(await r2.json()).toMatchObject({ updated: 0 });
    expect(await xpOf(ana.id)).toBe(30);
  });
});
