import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getOpenTo, listTalent, parseOpenTo, setOpenTo } from "@/lib/talent";

// spec 014 — diretório "open to": opt-in comercial do membro, prova do arquivo.

const HACK_A = "hack-inova-unifacens-2026"; // "Hackathon Inova AI × Payment Shift"
const HACK_B = "hack-inova-puc-saude-2026"; // "Hackathon de IA na Saúde — PUC Consolação"

async function makeMember(
  clerkId: string,
  extra: Partial<{ username: string; xp: number }> = {},
): Promise<number> {
  await db.prepare(
    `INSERT INTO members (clerkId, username, email, xp)
     VALUES (?, ?, ?, ?)`,
  ).run(
    clerkId,
    extra.username ?? `u_${clerkId}`,
    `${clerkId}@t.dev`,
    extra.xp ?? 0,
  );
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

async function linkTeam(
  username: string,
  hackathonId: string,
  teamName: string,
  placement: number,
): Promise<void> {
  const res = await db
    .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, ?)")
    .run(hackathonId, teamName, placement);
  await db.prepare(
    "INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)",
  ).run(Number(res.lastInsertRowid), username);
}

describe("parseOpenTo", () => {
  it("parseia CSV, ignora lixo e valores fora da whitelist", () => {
    expect(parseOpenTo("trampo, freela")).toEqual(["trampo", "freela"]);
    expect(parseOpenTo(null)).toEqual([]);
    expect(parseOpenTo("")).toEqual([]);
    expect(parseOpenTo("trampo,invalido,mentoria")).toEqual([
      "trampo",
      "mentoria",
    ]);
  });
});

describe("setOpenTo", () => {
  it("grava a whitelist e lê de volta via getOpenTo", async () => {
    const id = await makeMember("tal-1");
    await setOpenTo(id, ["trampo", "mentoria"]);
    expect(await getOpenTo(id)).toEqual(["trampo", "mentoria"]);
  });

  it("deduplica e normaliza caixa/espaços", async () => {
    const id = await makeMember("tal-2");
    await setOpenTo(id, [" Trampo ", "trampo", "FREELA"]);
    expect(await getOpenTo(id)).toEqual(["trampo", "freela"]);
  });

  it("rejeita valor fora da whitelist e não grava nada", async () => {
    const id = await makeMember("tal-3");
    await setOpenTo(id, ["trampo"]);
    await expect(setOpenTo(id, ["famoso"])).rejects.toThrow();
    await expect(setOpenTo(id, ["trampo", "famoso"])).rejects.toThrow();
    expect(await getOpenTo(id)).toEqual(["trampo"]); // lista anterior intacta
  });

  it("[] limpa pra NULL — o membro sai do diretório", async () => {
    const id = await makeMember("tal-4");
    await setOpenTo(id, ["freela"]);
    await setOpenTo(id, []);
    expect(await getOpenTo(id)).toEqual([]);
    const row = await db
      .prepare("SELECT openTo FROM members WHERE id = ?")
      .get(id) as { openTo: string | null };
    expect(row.openTo).toBeNull();
  });
});

describe("listTalent", () => {
  it("lista só quem tem openTo preenchido — NULL e '' ficam fora", async () => {
    const in_ = await makeMember("tal-in");
    await setOpenTo(in_, ["trampo"]);
    await makeMember("tal-null"); // openTo NULL por default
    const empty = await makeMember("tal-empty");
    await db.prepare("UPDATE members SET openTo = '' WHERE id = ?").run(empty);

    const usernames = (await listTalent()).map((t) => t.username);
    expect(usernames).toContain("u_tal-in");
    expect(usernames).not.toContain("u_tal-null");
    expect(usernames).not.toContain("u_tal-empty");
  });

  it("ordena por xp desc com desempate determinístico por username", async () => {
    const hi = await makeMember("tal-hi", { xp: 900, username: "tal_zhi" });
    const lo = await makeMember("tal-lo", { xp: 10, username: "tal_alo" });
    const tie = await makeMember("tal-tie", { xp: 900, username: "tal_atie" });
    await setOpenTo(hi, ["trampo"]);
    await setOpenTo(lo, ["freela"]);
    await setOpenTo(tie, ["mentoria"]);

    const usernames = (await listTalent()).map((t) => t.username);
    expect(usernames.indexOf("tal_zhi")).toBeLessThan(
      usernames.indexOf("tal_alo"),
    );
    // empate em 900xp: tal_atie antes de tal_zhi por username asc
    expect(usernames.indexOf("tal_atie")).toBeLessThan(
      usernames.indexOf("tal_zhi"),
    );
  });

  it("traz openTo parseado, skills, contagem de projetos e melhor colocação com edição", async () => {
    const id = await makeMember("tal-best", { xp: 50, username: "tal_best" });
    await setOpenTo(id, ["cofundador", "freela"]);
    await linkTeam("tal_best", HACK_B, "Time Segundo", 2);
    await linkTeam("tal_best", HACK_A, "Time Campeao", 1);

    const t = (await listTalent()).find((x) => x.username === "tal_best")!;
    expect(t.openTo).toEqual(["cofundador", "freela"]);
    expect(t.projects).toBe(2);
    expect(t.best).toEqual({
      placement: 1,
      hackathonId: HACK_A,
      hackathonName: "Hackathon Inova AI × Payment Shift",
    });
  });

  it("membro sem pódio tem best null e continua no diretório", async () => {
    const id = await makeMember("tal-nopodium", { username: "tal_nop" });
    await setOpenTo(id, ["mentoria"]);
    await linkTeam("tal_nop", HACK_A, "Time Participante", 0);

    const t = (await listTalent()).find((x) => x.username === "tal_nop")!;
    expect(t.projects).toBe(1);
    expect(t.best).toBeNull();
  });

  it("respeita o limite", async () => {
    expect(await listTalent(1)).toHaveLength(1);
  });
});
