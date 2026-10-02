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

function makeMember(clerkId: string): number {
  db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

beforeEach(() => {
  db.prepare("DELETE FROM looking_for_team").run();
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
  it("cria com created=true e retorna entry com join do membro", () => {
    const m = makeMember("tb1");
    const { entry, created } = upsertBoardEntry(m, HID, {
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

  it("re-anunciar atualiza (created=false), não duplica", () => {
    const m = makeMember("tb2");
    upsertBoardEntry(m, HID, { skills: [], need: "v1", note: null });
    const { entry, created } = upsertBoardEntry(m, HID, {
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
        db
          .prepare(
            "SELECT COUNT(*) n FROM looking_for_team WHERE memberId = ? AND hackathonId = ?",
          )
          .get(m, HID) as { n: number }
      ).n,
    ).toBe(1);
  });

  it("re-anunciar reativa entry desativada", () => {
    const m = makeMember("tb3");
    upsertBoardEntry(m, HID, { skills: [], need: "v1", note: null });
    deactivateBoardEntry(m, HID);
    expect(getBoardEntry(m, HID)?.active).toBe(false);
    const { entry, created } = upsertBoardEntry(m, HID, {
      skills: [],
      need: "voltei",
      note: null,
    });
    expect(created).toBe(false);
    expect(entry.active).toBe(true);
  });
});

describe("listBoardEntries / countBoardEntries", () => {
  it("lista só ativos da edição, ASC, com dados do membro", () => {
    const a = makeMember("tb4");
    const b = makeMember("tb5");
    db.prepare("UPDATE members SET persona = 'dev', xp = 150, headline = 'front' WHERE id = ?").run(a);
    upsertBoardEntry(a, HID, { skills: ["react"], need: "dados", note: null });
    upsertBoardEntry(b, HID, { skills: [], need: "front", note: "oi" });
    upsertBoardEntry(a, HID2, { skills: [], need: "outra edição", note: null });
    deactivateBoardEntry(b, HID);

    const list = listBoardEntries(HID);
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe("u_tb4");
    expect(list[0].persona).toBe("dev");
    expect(list[0].xp).toBe(150);
    expect(list[0].headline).toBe("front");
    expect(countBoardEntries(HID)).toBe(1);
    expect(countBoardEntries(HID2)).toBe(1);
  });

  it("ordena por createdAt ASC com desempate por id", () => {
    const a = makeMember("tb6");
    const b = makeMember("tb7");
    upsertBoardEntry(a, HID, { skills: [], need: "primeiro", note: null });
    upsertBoardEntry(b, HID, { skills: [], need: "segundo", note: null });
    const list = listBoardEntries(HID);
    expect(list.map((e) => e.need)).toEqual(["primeiro", "segundo"]);
  });
});

describe("deactivateBoardEntry / setBoardEntryActive", () => {
  it("deactivate é idempotente — sem entry não quebra", () => {
    const m = makeMember("tb8");
    expect(() => deactivateBoardEntry(m, HID)).not.toThrow();
    upsertBoardEntry(m, HID, { skills: [], need: "x", note: null });
    deactivateBoardEntry(m, HID);
    deactivateBoardEntry(m, HID);
    expect(getBoardEntry(m, HID)?.active).toBe(false);
    expect(listBoardEntries(HID)).toHaveLength(0);
  });

  it("setBoardEntryActive liga/desliga por id; id inexistente → null", () => {
    const m = makeMember("tb9");
    const { entry } = upsertBoardEntry(m, HID, {
      skills: [],
      need: "x",
      note: null,
    });
    const off = setBoardEntryActive(entry.id, false);
    expect(off?.active).toBe(false);
    expect(listBoardEntries(HID)).toHaveLength(0);
    const on = setBoardEntryActive(entry.id, true);
    expect(on?.active).toBe(true);
    expect(setBoardEntryActive(999999, false)).toBeNull();
  });
});
