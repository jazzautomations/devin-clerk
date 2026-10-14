import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  countBoardEntries,
  deactivateBoardEntry,
  getBoardEntry,
  listBoardEntries,
  setBoardEntryActive,
  upsertBoardEntry,
  validateBoardInput,
} from "@/lib/teamboard";

const HID = "hack-inova-alphaville-2026";
const HID2 = "hack-inova-puc-saude-2026";

async function makeMember(clerkId: string): Promise<number> {
  await db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

beforeEach(async () => {
  await db.prepare("DELETE FROM looking_for_team").run();
});

describe("validateBoardInput", () => {
  it("aceita input mínimo e faz trim", () => {
    const v = validateBoardInput({ need: "  alguém de dados  " });
    expect(v.need).toBe("alguém de dados");
    expect(v.skills).toEqual([]);
    expect(v.note).toBeNull();
  });

  it("rejeita need vazio, só espaços, >200 e não-string", () => {
    for (const need of ["", "   ", "x".repeat(201), 42, undefined]) {
      expect(() =>
        validateBoardInput({ need: need as string }),
      ).toThrow();
    }
    expect(validateBoardInput({ need: "x".repeat(200) }).need).toHaveLength(
      200,
    );
  });

  it("rejeita note >300 e não-string; vazio vira null", () => {
    expect(() =>
      validateBoardInput({ need: "ok", note: "x".repeat(301) }),
    ).toThrow();
    expect(() =>
      validateBoardInput({ need: "ok", note: 5 as unknown as string }),
    ).toThrow();
    expect(validateBoardInput({ need: "ok", note: "  " }).note).toBeNull();
    expect(
      validateBoardInput({ need: "ok", note: "call me" }).note,
    ).toBe("call me");
  });

  it("skills: não-array rejeita; sanitiza trim/vazio/dup e limita", () => {
    expect(() =>
      validateBoardInput({ need: "ok", skills: "react" as unknown as [] }),
    ).toThrow();
    const v = validateBoardInput({
      need: "ok",
      skills: [" react ", "", "react", "node", 7 as unknown as string],
    });
    expect(v.skills).toEqual(["react", "node"]);
    const many = validateBoardInput({
      need: "ok",
      skills: Array.from({ length: 15 }, (_, i) => `s${i}`),
    });
    expect(many.skills).toHaveLength(10);
  });
});

describe("upsertBoardEntry", () => {
  it("cria com created=true e retorna entry com join do membro", async () => {
    const m = await makeMember("tb1");
    const { entry, created } = await upsertBoardEntry(m, HID, {
      skills: ["react"],
      need: "alguém de dados",
      note: null,
    });
    expect(created).toBe(true);
    expect(entry.username).toBe("u_tb1");
    expect(entry.skills).toEqual(["react"]);
    expect(entry.need).toBe("alguém de dados");
    expect(entry.active).toBe(true);
    expect(entry.hackathonId).toBe(HID);
  });

  it("re-anunciar atualiza (created=false), não duplica", async () => {
    const m = await makeMember("tb2");
    await upsertBoardEntry(m, HID, { skills: [], need: "v1", note: null });
    const { entry, created } = await upsertBoardEntry(m, HID, {
      skills: ["node"],
      need: "v2 — designer",
      note: "nota",
    });
    expect(created).toBe(false);
    expect(entry.need).toBe("v2 — designer");
    expect(entry.skills).toEqual(["node"]);
    expect(entry.note).toBe("nota");
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM looking_for_team WHERE memberId = ? AND hackathonId = ?",
          )
          .get(m, HID) as { n: number }
      ).n,
    ).toBe(1);
  });

  it("re-anunciar reativa entry desativada", async () => {
    const m = await makeMember("tb3");
    await upsertBoardEntry(m, HID, { skills: [], need: "v1", note: null });
    await deactivateBoardEntry(m, HID);
    expect((await getBoardEntry(m, HID))?.active).toBe(false);
    const { entry, created } = await upsertBoardEntry(m, HID, {
      skills: [],
      need: "voltei",
      note: null,
    });
    expect(created).toBe(false);
    expect(entry.active).toBe(true);
  });
});

describe("listBoardEntries / countBoardEntries", () => {
  it("lista só ativos da edição, ASC, com dados do membro", async () => {
    const a = await makeMember("tb4");
    const b = await makeMember("tb5");
    await db.prepare("UPDATE members SET persona = 'dev', xp = 150, headline = 'front' WHERE id = ?").run(a);
    await upsertBoardEntry(a, HID, { skills: ["react"], need: "dados", note: null });
    await upsertBoardEntry(b, HID, { skills: [], need: "front", note: "oi" });
    await upsertBoardEntry(a, HID2, { skills: [], need: "outra edição", note: null });
    await deactivateBoardEntry(b, HID);

    const list = await listBoardEntries(HID);
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe("u_tb4");
    expect(list[0].persona).toBe("dev");
    expect(list[0].xp).toBe(150);
    expect(list[0].headline).toBe("front");
    expect(await countBoardEntries(HID)).toBe(1);
    expect(await countBoardEntries(HID2)).toBe(1);
  });

  it("ordena por createdAt ASC com desempate por id", async () => {
    const a = await makeMember("tb6");
    const b = await makeMember("tb7");
    await upsertBoardEntry(a, HID, { skills: [], need: "primeiro", note: null });
    await upsertBoardEntry(b, HID, { skills: [], need: "segundo", note: null });
    const list = await listBoardEntries(HID);
    expect(list.map((e) => e.need)).toEqual(["primeiro", "segundo"]);
  });
});

describe("deactivateBoardEntry / setBoardEntryActive", () => {
  it("deactivate é idempotente — sem entry não quebra", async () => {
    const m = await makeMember("tb8");
    await expect(deactivateBoardEntry(m, HID)).resolves.not.toThrow();
    await upsertBoardEntry(m, HID, { skills: [], need: "x", note: null });
    await deactivateBoardEntry(m, HID);
    await deactivateBoardEntry(m, HID);
    expect((await getBoardEntry(m, HID))?.active).toBe(false);
    expect(await listBoardEntries(HID)).toHaveLength(0);
  });

  it("setBoardEntryActive liga/desliga por id; id inexistente → null", async () => {
    const m = await makeMember("tb9");
    const { entry } = await upsertBoardEntry(m, HID, {
      skills: [],
      need: "x",
      note: null,
    });
    const off = await setBoardEntryActive(entry.id, false);
    expect(off?.active).toBe(false);
    expect(await listBoardEntries(HID)).toHaveLength(0);
    const on = await setBoardEntryActive(entry.id, true);
    expect(on?.active).toBe(true);
    expect(await setBoardEntryActive(999999, false)).toBeNull();
  });
});
