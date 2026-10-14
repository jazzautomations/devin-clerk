import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { listSubscribers, updateHackathon } from "@/lib/admin";
import { listRegistrants } from "@/lib/registrations";
import { getHackathon } from "@/lib/hackathons";

const HID = "admin-ops-test";

async function resetHackathon(): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline, tags, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    HID,
    "Hack Teste Ops",
    "Hack Inova",
    "2026-12-01T09:00:00-03:00",
    "2026-12-02T18:00:00-03:00",
    "presencial",
    "Sorocaba, SP",
    "https://hackinova.vercel.app",
    "2026-11-30T23:59:00-03:00",
    '["ia"]',
  );
}

async function makeMember(username: string): Promise<number> {
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, name, email) VALUES (?, ?, ?, ?)",
  ).run(`clerk_${username}`, username, `Nome ${username}`, `${username}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE username = ?").get(username) as {
      id: number;
    }
  ).id;
}

beforeEach(async () => {
  await resetHackathon();
  await db.prepare("DELETE FROM registrations").run();
  await db.prepare("DELETE FROM subscribers").run();
});

describe("updateHackathon — edição parcial", () => {
  it("aplica só os campos enviados e preserva o resto", async () => {
    const h = await updateHackathon(HID, { name: "Nome Novo", location: "Campinas" });
    expect(h?.name).toBe("Nome Novo");
    expect(h?.location).toBe("Campinas");
    // não mexeu no resto
    expect(h?.organizer).toBe("Hack Inova");
    expect(h?.format).toBe("presencial");
    expect(h?.startsAt).toBe("2026-12-01T09:00:00-03:00");
    expect(h?.active).toBe(true);
  });

  it("aceita null pra limpar campo opcional", async () => {
    const h = await updateHackathon(HID, { endsAt: null, location: null });
    expect(h?.endsAt).toBeNull();
    expect(h?.location).toBeNull();
  });

  it("toggle active arquiva sem apagar", async () => {
    const h = await updateHackathon(HID, { active: false });
    expect(h?.active).toBe(false);
    expect(await getHackathon(HID)).not.toBeNull(); // registro continua lá
  });

  it("serializa tags como JSON", async () => {
    const h = await updateHackathon(HID, { tags: ["ia", "saude"] });
    expect(h?.tags).toEqual(["ia", "saude"]);
  });

  it("retorna null pra edição inexistente", async () => {
    expect(await updateHackathon("fantasma", { name: "x" })).toBeNull();
  });
});

describe("listRegistrants — inscritos por edição com e-mail", () => {
  it("retorna username, name, email e createdAt ordenados por entrada", async () => {
    const a = await makeMember("ana");
    const b = await makeMember("bia");
    await db.prepare(
      "INSERT INTO registrations (memberId, hackathonId, createdAt) VALUES (?, ?, '2026-10-01 10:00:00')",
    ).run(a, HID);
    await db.prepare(
      "INSERT INTO registrations (memberId, hackathonId, createdAt) VALUES (?, ?, '2026-10-02 10:00:00')",
    ).run(b, HID);
    const list = await listRegistrants(HID);
    expect(list).toHaveLength(2);
    expect(list[0].username).toBe("ana");
    expect(list[0].email).toBe("ana@t.dev");
    expect(list[0].name).toBe("Nome ana");
    expect(list[0].createdAt).toBe("2026-10-01 10:00:00");
    expect(list[1].username).toBe("bia");
  });

  it("edição sem inscritos retorna lista vazia", async () => {
    expect(await listRegistrants(HID)).toEqual([]);
  });
});

describe("listSubscribers — base da newsletter", () => {
  it("retorna emails com createdAt, mais recente primeiro", async () => {
    await db.prepare(
      "INSERT INTO subscribers (email, createdAt) VALUES ('a@x.dev', '2026-09-01 10:00:00')",
    ).run();
    await db.prepare(
      "INSERT INTO subscribers (email, createdAt) VALUES ('b@x.dev', '2026-09-02 10:00:00')",
    ).run();
    const subs = await listSubscribers();
    expect(subs).toHaveLength(2);
    expect(subs[0].email).toBe("b@x.dev");
    expect(subs[1].email).toBe("a@x.dev");
    expect(subs[0].createdAt).toBeTruthy();
  });
});
