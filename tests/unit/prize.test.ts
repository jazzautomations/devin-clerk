import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getHackathon, getOpenHackathons } from "@/lib/hackathons";
import { updateHackathon } from "@/lib/admin";

// spec 024 — prêmio é campo de display livre ("$138,000", "R$ 5 mil"):
// coluna TEXT, scraper formata, UI repassa verbatim.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_admin" })),
  currentUser: vi.fn(async () => null),
}));

const HID = "prize-unit-test";
const params = Promise.resolve({ id: HID });

async function makeHackathon(prize?: string | null): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl, tags, active, prize)
     VALUES (?, 'Prize Jam', 'Org', '2099-01-01T09:00:00-03:00', 'online',
             'https://x.dev', '[]', 1, ?)`,
  ).run(HID, prize ?? null);
}

beforeEach(async () => {
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_admin','prize_admin','p@t.dev','admin')",
  ).run();
  await db.prepare("DELETE FROM hackathons WHERE id = ?").run(HID);
});

describe("hackathons.prize — coluna e tipo", () => {
  it("seed da Unifacens carrega o prêmio real divulgado (R$ 5 mil)", async () => {
    const h = await getHackathon("hack-inova-unifacens-2026");
    expect(h?.prize).toBe("R$ 5 mil");
  });

  it("edição sem prêmio retorna null e listagem carrega o campo", async () => {
    await makeHackathon();
    expect((await getHackathon(HID))!.prize).toBeNull();
    const up = await getOpenHackathons();
    expect(up.find((h) => h.id === HID)?.prize).toBeNull();
  });

  it("updateHackathon define, edita e limpa (null) o prêmio", async () => {
    await makeHackathon();
    expect((await updateHackathon(HID, { prize: "R$ 42 mil" }))?.prize).toBe(
      "R$ 42 mil",
    );
    expect((await getHackathon(HID))!.prize).toBe("R$ 42 mil");
    // null explícito limpa — mesmo contrato de endsAt/location
    expect((await updateHackathon(HID, { prize: null }))?.prize).toBeNull();
  });
});

describe("PATCH /api/admin/hackathons/[id] — prize", () => {
  const req = (body: unknown) =>
    new Request(`http://t/api/admin/hackathons/${HID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("admin define/limpa prêmio → 200 e persiste", async () => {
    await makeHackathon();
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(req({ prize: "R$ 10 mil" }), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).hackathon.prize).toBe("R$ 10 mil");
    expect((await getHackathon(HID))!.prize).toBe("R$ 10 mil");

    const cleared = await PATCH(req({ prize: null }), { params });
    expect(cleared.status).toBe(200);
    expect((await getHackathon(HID))!.prize).toBeNull();
  });

  it("400 em tipo errado de prize", async () => {
    await makeHackathon();
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    for (const body of [{ prize: 5000 }, { prize: { v: 1 } }]) {
      const res = await PATCH(req(body), { params });
      expect(res.status).toBe(400);
    }
    expect((await getHackathon(HID))!.prize).toBeNull();
  });
});
