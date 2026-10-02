import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { listSubscribers, updateHackathon } from "@/lib/admin";
import { listRegistrants } from "@/lib/registrations";
import { getHackathon } from "@/lib/hackathons";

const HID = "admin-ops-test";

function resetHackathon(): void {
  db.prepare(
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

function makeMember(username: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, name, email) VALUES (?, ?, ?, ?)",
  ).run(`clerk_${username}`, username, `Nome ${username}`, `${username}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE username = ?").get(username) as {
      id: number;
    }
  ).id;
}

beforeEach(() => {
  resetHackathon();
  db.prepare("DELETE FROM registrations").run();
  db.prepare("DELETE FROM subscribers").run();
});

describe("updateHackathon — edição parcial", () => {
  it("aplica só os campos enviados e preserva o resto", () => {
    const h = updateHackathon(HID, { name: "Nome Novo", location: "Campinas" });
    expect(h?.name).toBe("Nome Novo");
    expect(h?.location).toBe("Campinas");
    // não mexeu no resto
    expect(h?.organizer).toBe("Hack Inova");
    expect(h?.format).toBe("presencial");
    expect(h?.startsAt).toBe("2026-12-01T09:00:00-03:00");
    expect(h?.active).toBe(true);
  });

  it("aceita null pra limpar campo opcional", () => {
    const h = updateHackathon(HID, { endsAt: null, location: null });
    expect(h?.endsAt).toBeNull();
    expect(h?.location).toBeNull();
  });

  it("toggle active arquiva sem apagar", () => {
    const h = updateHackathon(HID, { active: false });
    expect(h?.active).toBe(false);
    expect(getHackathon(HID)).not.toBeNull(); // registro continua lá
  });

  it("serializa tags como JSON", () => {
    const h = updateHackathon(HID, { tags: ["ia", "saude"] });
    expect(h?.tags).toEqual(["ia", "saude"]);
  });

  it("retorna null pra edição inexistente", () => {
    expect(updateHackathon("fantasma", { name: "x" })).toBeNull();
  });
});

describe("listRegistrants — inscritos por edição com e-mail", () => {
  it("retorna username, name, email e createdAt ordenados por entrada", () => {
    const a = makeMember("ana");
    const b = makeMember("bia");
    db.prepare(
      "INSERT INTO registrations (memberId, hackathonId, createdAt) VALUES (?, ?, '2026-10-01 10:00:00')",
    ).run(a, HID);
    db.prepare(
      "INSERT INTO registrations (memberId, hackathonId, createdAt) VALUES (?, ?, '2026-10-02 10:00:00')",
    ).run(b, HID);
    const list = listRegistrants(HID);
    expect(list).toHaveLength(2);
    expect(list[0].username).toBe("ana");
    expect(list[0].email).toBe("ana@t.dev");
    expect(list[0].name).toBe("Nome ana");
    expect(list[0].createdAt).toBe("2026-10-01 10:00:00");
    expect(list[1].username).toBe("bia");
  });

  it("edição sem inscritos retorna lista vazia", () => {
    expect(listRegistrants(HID)).toEqual([]);
  });
});

describe("listSubscribers — base da newsletter", () => {
  it("retorna emails com createdAt, mais recente primeiro", () => {
    db.prepare(
      "INSERT INTO subscribers (email, createdAt) VALUES ('a@x.dev', '2026-09-01 10:00:00')",
    ).run();
    db.prepare(
      "INSERT INTO subscribers (email, createdAt) VALUES ('b@x.dev', '2026-09-02 10:00:00')",
    ).run();
    const subs = listSubscribers();
    expect(subs).toHaveLength(2);
    expect(subs[0].email).toBe("b@x.dev");
    expect(subs[1].email).toBe("a@x.dev");
    expect(subs[0].createdAt).toBeTruthy();
  });
});
