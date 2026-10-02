import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  addAsset,
  createTeam,
  getArchive,
  getMemberProjects,
} from "@/lib/archive";

const HACK = "hack-inova-unifacens-2026";

function makeMember(username: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
}

beforeEach(() => {
  db.prepare("DELETE FROM team_members").run();
  db.prepare("DELETE FROM team_projects").run();
  db.prepare("DELETE FROM teams").run();
  db.prepare("DELETE FROM edition_assets").run();
});

describe("createTeam + getArchive", () => {
  it("times ordenam por placement — pódio primeiro", () => {
    createTeam(HACK, { name: "Time C", placement: 0 });
    createTeam(HACK, { name: "One Day Hospital", placement: 1 });
    createTeam(HACK, { name: "Time B", placement: 2 });
    const archive = getArchive(HACK);
    expect(archive.teams.map((t) => t.name)).toEqual([
      "One Day Hospital",
      "Time B",
      "Time C",
    ]);
  });

  it("time carrega projeto e membros vinculados", () => {
    makeMember("devana");
    const { team, ignoredUsernames } = createTeam(HACK, {
      name: "ODH",
      placement: 1,
      memberUsernames: ["devana", "fantasma_que_nao_existe"],
      project: {
        title: "One Day Hospital",
        description: "triage por IA",
        repoUrl: "https://github.com/x/odh",
        demoUrl: null,
      },
    });
    expect(ignoredUsernames).toEqual(["fantasma_que_nao_existe"]);
    const archive = getArchive(HACK);
    const t = archive.teams.find((x) => x.id === team.id)!;
    expect(t.project?.title).toBe("One Day Hospital");
    expect(t.members).toContain("devana");
    expect(t.members).not.toContain("fantasma_que_nao_existe");
  });

  it("time sem projeto renderiza só nome+colocação", () => {
    createTeam(HACK, { name: "SóNome", placement: 0 });
    const t = getArchive(HACK).teams[0];
    expect(t.project).toBeNull();
  });
});

describe("addAsset", () => {
  it("aceita foto/slide/material com url http(s); rejeita o resto", () => {
    const a = addAsset(HACK, { type: "foto", url: "https://imgur.com/x.png" });
    expect(a.id).toBeGreaterThan(0);
    expect(() =>
      addAsset(HACK, { type: "video", url: "https://x.dev" }),
    ).toThrow();
    expect(() =>
      addAsset(HACK, { type: "foto", url: "javascript:alert(1)" }),
    ).toThrow();
    const archive = getArchive(HACK);
    expect(archive.assets).toHaveLength(1);
    expect(archive.assets[0].type).toBe("foto");
  });
});

describe("getMemberProjects — crédito no perfil", () => {
  it("projeto aparece no perfil de quem tava no time, com placement", () => {
    makeMember("campeao");
    createTeam(HACK, {
      name: "ODH",
      placement: 1,
      memberUsernames: ["campeao"],
      project: { title: "One Day Hospital", repoUrl: "https://github.com/x/odh" },
    });
    const projects = getMemberProjects("campeao");
    expect(projects).toHaveLength(1);
    expect(projects[0].project?.title).toBe("One Day Hospital");
    expect(projects[0].placement).toBe(1);
    expect(projects[0].hackathonName).toContain("Payment Shift");
  });
});
