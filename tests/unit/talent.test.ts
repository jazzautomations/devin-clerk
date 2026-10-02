import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getOpenTo, listTalent, parseOpenTo, setOpenTo } from "@/lib/talent";

// spec 014 — diretório "open to": opt-in comercial do membro, prova do arquivo.

const HACK_A = "hack-inova-unifacens-2026"; // "Hackathon Inova AI × Payment Shift"
const HACK_B = "hack-inova-puc-saude-2026"; // "Hackathon de IA na Saúde — PUC Consolação"

function makeMember(
  clerkId: string,
  extra: Partial<{ username: string; xp: number }> = {},
): number {
  db.prepare(
    `INSERT INTO members (clerkId, username, email, xp)
     VALUES (?, ?, ?, ?)`,
  ).run(
    clerkId,
    extra.username ?? `u_${clerkId}`,
    `${clerkId}@t.dev`,
    extra.xp ?? 0,
  );
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

function linkTeam(
  username: string,
  hackathonId: string,
  teamName: string,
  placement: number,
): void {
  const res = db
    .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, ?)")
    .run(hackathonId, teamName, placement);
  db.prepare(
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
  it("grava a whitelist e lê de volta via getOpenTo", () => {
    const id = makeMember("tal-1");
    setOpenTo(id, ["trampo", "mentoria"]);
    expect(getOpenTo(id)).toEqual(["trampo", "mentoria"]);
  });

  it("deduplica e normaliza caixa/espaços", () => {
    const id = makeMember("tal-2");
    setOpenTo(id, [" Trampo ", "trampo", "FREELA"]);
    expect(getOpenTo(id)).toEqual(["trampo", "freela"]);
  });

  it("rejeita valor fora da whitelist e não grava nada", () => {
    const id = makeMember("tal-3");
    setOpenTo(id, ["trampo"]);
    expect(() => setOpenTo(id, ["famoso"])).toThrow();
    expect(() => setOpenTo(id, ["trampo", "famoso"])).toThrow();
    expect(getOpenTo(id)).toEqual(["trampo"]); // lista anterior intacta
  });

  it("[] limpa pra NULL — o membro sai do diretório", () => {
    const id = makeMember("tal-4");
    setOpenTo(id, ["freela"]);
    setOpenTo(id, []);
    expect(getOpenTo(id)).toEqual([]);
    const row = db
      .prepare("SELECT openTo FROM members WHERE id = ?")
      .get(id) as { openTo: string | null };
    expect(row.openTo).toBeNull();
  });
});

describe("listTalent", () => {
  it("lista só quem tem openTo preenchido — NULL e '' ficam fora", () => {
    const in_ = makeMember("tal-in");
    setOpenTo(in_, ["trampo"]);
    makeMember("tal-null"); // openTo NULL por default
    const empty = makeMember("tal-empty");
    db.prepare("UPDATE members SET openTo = '' WHERE id = ?").run(empty);

    const usernames = listTalent().map((t) => t.username);
    expect(usernames).toContain("u_tal-in");
    expect(usernames).not.toContain("u_tal-null");
    expect(usernames).not.toContain("u_tal-empty");
  });

  it("ordena por xp desc com desempate determinístico por username", () => {
    const hi = makeMember("tal-hi", { xp: 900, username: "tal_zhi" });
    const lo = makeMember("tal-lo", { xp: 10, username: "tal_alo" });
    const tie = makeMember("tal-tie", { xp: 900, username: "tal_atie" });
    setOpenTo(hi, ["trampo"]);
    setOpenTo(lo, ["freela"]);
    setOpenTo(tie, ["mentoria"]);

    const usernames = listTalent().map((t) => t.username);
    expect(usernames.indexOf("tal_zhi")).toBeLessThan(
      usernames.indexOf("tal_alo"),
    );
    // empate em 900xp: tal_atie antes de tal_zhi por username asc
    expect(usernames.indexOf("tal_atie")).toBeLessThan(
      usernames.indexOf("tal_zhi"),
    );
  });

  it("traz openTo parseado, skills, contagem de projetos e melhor colocação com edição", () => {
    const id = makeMember("tal-best", { xp: 50, username: "tal_best" });
    setOpenTo(id, ["cofundador", "freela"]);
    linkTeam("tal_best", HACK_B, "Time Segundo", 2);
    linkTeam("tal_best", HACK_A, "Time Campeao", 1);

    const t = listTalent().find((x) => x.username === "tal_best")!;
    expect(t.openTo).toEqual(["cofundador", "freela"]);
    expect(t.projects).toBe(2);
    expect(t.best).toEqual({
      placement: 1,
      hackathonId: HACK_A,
      hackathonName: "Hackathon Inova AI × Payment Shift",
    });
  });

  it("membro sem pódio tem best null e continua no diretório", () => {
    const id = makeMember("tal-nopodium", { username: "tal_nop" });
    setOpenTo(id, ["mentoria"]);
    linkTeam("tal_nop", HACK_A, "Time Participante", 0);

    const t = listTalent().find((x) => x.username === "tal_nop")!;
    expect(t.projects).toBe(1);
    expect(t.best).toBeNull();
  });

  it("respeita o limite", () => {
    expect(listTalent(1)).toHaveLength(1);
  });
});
