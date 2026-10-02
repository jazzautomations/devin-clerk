import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  addAsset,
  createTeam,
  getArchive,
  getMemberArc,
  getMemberProjects,
} from "@/lib/archive";
import { register } from "@/lib/registrations";

const HACK = "hack-inova-unifacens-2026";
const HACK_PUC = "hack-inova-puc-saude-2026";
const HACK_ANHEMBI = "hackinova-os-2-anhembi-2026";

function makeMember(username: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
}

function memberId(username: string): number {
  return (
    db.prepare("SELECT id FROM members WHERE username = ?").get(username) as {
      id: number;
    }
  ).id;
}

beforeEach(() => {
  db.prepare("DELETE FROM team_members").run();
  db.prepare("DELETE FROM team_projects").run();
  db.prepare("DELETE FROM teams").run();
  db.prepare("DELETE FROM edition_assets").run();
  db.prepare("DELETE FROM registrations").run();
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

// spec 029 — trajetória: união inscrições ∪ times, cronológica (antiga→nova)
describe("getMemberArc — trajetória do builder", () => {
  it("ordena da edição mais antiga pra mais nova, mesmo inserindo fora de ordem", () => {
    makeMember("arcorder");
    const id = memberId("arcorder");
    // inscreve na mais recente primeiro e no meio depois; time na mais antiga
    register(id, HACK_ANHEMBI); // 2026-09-22
    createTeam(HACK, {
      name: "Time Arc",
      placement: 0,
      memberUsernames: ["arcorder"],
    }); // 2026-08-17
    register(id, HACK_PUC); // 2026-09-12

    const arc = getMemberArc("arcorder");
    expect(arc.map((e) => e.hackathonId)).toEqual([HACK, HACK_PUC, HACK_ANHEMBI]);
  });

  it("resolve placement pelo time do membro (pódio viaja junto)", () => {
    makeMember("arcvice");
    createTeam(HACK, {
      name: "Vice",
      placement: 2,
      memberUsernames: ["arcvice"],
      project: { title: "Quase Lá" },
    });
    const arc = getMemberArc("arcvice");
    expect(arc).toHaveLength(1);
    expect(arc[0].placement).toBe(2);
    expect(arc[0].hasProject).toBe(true);
    expect(arc[0].teamName).toBe("Vice");
  });

  it("inscrito sem time = participou: placement 0, sem projeto, sem timeId", () => {
    makeMember("arcsolo");
    register(memberId("arcsolo"), HACK_PUC);
    const arc = getMemberArc("arcsolo");
    expect(arc).toHaveLength(1);
    expect(arc[0].hackathonId).toBe(HACK_PUC);
    expect(arc[0].placement).toBe(0);
    expect(arc[0].hasProject).toBe(false);
    expect(arc[0].teamId).toBeNull();
    expect(arc[0].hackathonName).toContain("PUC");
    expect(arc[0].startsAt).toContain("2026-09-12");
  });

  it("time sem inscrição também entra no arco — vínculo já é participação", () => {
    makeMember("arcadmin");
    createTeam(HACK_ANHEMBI, {
      name: "SemInscricao",
      placement: 3,
      memberUsernames: ["arcadmin"],
    });
    const arc = getMemberArc("arcadmin");
    expect(arc).toHaveLength(1);
    expect(arc[0].hackathonId).toBe(HACK_ANHEMBI);
    expect(arc[0].placement).toBe(3);
    expect(arc[0].hasProject).toBe(false);
  });

  it("inscrito E no time da mesma edição = uma entrada só, com dados do time", () => {
    makeMember("arcdedup");
    register(memberId("arcdedup"), HACK);
    createTeam(HACK, {
      name: "Dedup",
      placement: 1,
      memberUsernames: ["arcdedup"],
      project: { title: "Campeão" },
    });
    const arc = getMemberArc("arcdedup");
    expect(arc).toHaveLength(1);
    expect(arc[0].placement).toBe(1);
    expect(arc[0].hasProject).toBe(true);
  });

  it("time sem projeto entregue marca hasProject false", () => {
    makeMember("arcsemproj");
    createTeam(HACK, {
      name: "SemProjeto",
      placement: 0,
      memberUsernames: ["arcsemproj"],
    });
    expect(getMemberArc("arcsemproj")[0].hasProject).toBe(false);
  });

  it("membro sem participação nenhuma retorna lista vazia", () => {
    makeMember("arczero");
    expect(getMemberArc("arczero")).toEqual([]);
    expect(getMemberArc("fantasma_sem_member")).toEqual([]);
  });
});
