import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam, getProjectByTeamId } from "@/lib/archive";

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
});

describe("getProjectByTeamId — ficha pública do projeto", () => {
  it("retorna null pra teamId inexistente", () => {
    expect(getProjectByTeamId(999999)).toBeNull();
  });

  it("retorna null pra time sem projeto cadastrado", () => {
    const { team } = createTeam(HACK, { name: "SemProjeto", placement: 0 });
    expect(getProjectByTeamId(team.id)).toBeNull();
  });

  it("carrega projeto + time + edição + membros vinculados", () => {
    makeMember("devana");
    makeMember("beto");
    const { team } = createTeam(HACK, {
      name: "ODH",
      placement: 1,
      memberUsernames: ["beto", "devana"],
      project: {
        title: "One Day Hospital",
        description: "triage por IA",
        repoUrl: "https://github.com/x/odh",
        demoUrl: "https://odh.example.com",
      },
    });

    const page = getProjectByTeamId(team.id);
    expect(page).not.toBeNull();
    expect(page!.teamId).toBe(team.id);
    expect(page!.teamName).toBe("ODH");
    expect(page!.placement).toBe(1);
    expect(page!.hackathonId).toBe(HACK);
    expect(page!.hackathonName).toContain("Payment Shift");
    expect(page!.project.title).toBe("One Day Hospital");
    expect(page!.project.description).toBe("triage por IA");
    expect(page!.project.repoUrl).toBe("https://github.com/x/odh");
    expect(page!.project.demoUrl).toBe("https://odh.example.com");
    // membros ordenados por username, como no arquivo
    expect(page!.members).toEqual(["beto", "devana"]);
  });

  it("projeto sem descrição/links volta com nulls — a página decide o empty state", () => {
    const { team } = createTeam(HACK, {
      name: "Minimo",
      placement: 0,
      project: { title: "Só título" },
    });
    const page = getProjectByTeamId(team.id);
    expect(page).not.toBeNull();
    expect(page!.project.description).toBeNull();
    expect(page!.project.repoUrl).toBeNull();
    expect(page!.project.demoUrl).toBeNull();
    expect(page!.members).toEqual([]);
    expect(page!.placement).toBe(0);
  });
});
