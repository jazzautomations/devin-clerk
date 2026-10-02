import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import "@/lib/deploys"; // garante a tabela deploys no :memory:
import { listProjectEditions, listProjects } from "@/lib/projects";

// edições do seed (datas crescentes):
const UNIFACENS = "hack-inova-unifacens-2026"; // 2026-08-17
const PUC = "hack-inova-puc-saude-2026"; // 2026-09-12
const ANHEMBI = "hackinova-os-2-anhembi-2026"; // 2026-09-22

function makeMember(username: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
}

function insertDeploy(
  teamId: number,
  status: string,
  createdAt: string,
): void {
  db.prepare(
    "INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    `dep-${teamId}-${createdAt}`,
    teamId,
    "https://github.com/o/r",
    status,
    new Date(Date.now() + 9e5).toISOString(),
    createdAt,
    createdAt,
  );
}

beforeEach(() => {
  db.exec("DELETE FROM deploys");
  db.exec("DELETE FROM team_members");
  db.exec("DELETE FROM team_projects");
  db.exec("DELETE FROM teams");
});

describe("listProjects — índice público de projetos", () => {
  it("retorna [] quando nenhum time tem projeto", () => {
    createTeam(UNIFACENS, { name: "SemProjeto", placement: 0 });
    expect(listProjects()).toEqual([]);
  });

  it("INNER JOIN: time sem projeto fica fora; card traz todos os campos", () => {
    makeMember("ana");
    makeMember("bia");
    createTeam(UNIFACENS, { name: "SemProjeto", placement: 0 });
    const { team } = createTeam(UNIFACENS, {
      name: "ODH",
      placement: 1,
      memberUsernames: ["ana", "bia"],
      project: {
        title: "One Day Hospital",
        description: "triage por IA",
        repoUrl: "https://github.com/x/odh",
        demoUrl: "https://odh.example.com",
      },
    });

    const list = listProjects();
    expect(list).toHaveLength(1);
    const c = list[0];
    expect(c.teamId).toBe(team.id);
    expect(c.teamName).toBe("ODH");
    expect(c.placement).toBe(1);
    expect(c.hackathonId).toBe(UNIFACENS);
    expect(c.hackathonName).toContain("Payment Shift");
    expect(c.memberCount).toBe(2);
    expect(c.liveDeployId).toBeNull();
    expect(c.project).toEqual({
      title: "One Day Hospital",
      description: "triage por IA",
      repoUrl: "https://github.com/x/odh",
      demoUrl: "https://odh.example.com",
    });
  });

  it("ordena: colocação crescente, participante (0) por último, edição recente desempata", () => {
    const campeaAntiga = createTeam(UNIFACENS, {
      name: "W-old",
      placement: 1,
      project: { title: "w-old app" },
    }).team;
    const participanteNovo = createTeam(ANHEMBI, {
      name: "P-new",
      placement: 0,
      project: { title: "p-new app" },
    }).team;
    const participanteMeio = createTeam(PUC, {
      name: "P-mid",
      placement: 0,
      project: { title: "p-mid app" },
    }).team;
    const viceNovo = createTeam(ANHEMBI, {
      name: "W-new",
      placement: 2,
      project: { title: "w-new app" },
    }).team;

    const order = listProjects().map((c) => c.teamId);
    // 1º lugar (mesmo da edição mais antiga) → 2º → participantes, edição recente primeiro
    expect(order).toEqual([
      campeaAntiga.id,
      viceNovo.id,
      participanteNovo.id,
      participanteMeio.id,
    ]);
  });

  it("liveDeployId só quando o ÚLTIMO deploy tá running — demo antiga parada não conta", () => {
    const live = createTeam(UNIFACENS, {
      name: "Live",
      placement: 0,
      project: { title: "live app" },
    }).team;
    const stale = createTeam(UNIFACENS, {
      name: "Stale",
      placement: 0,
      project: { title: "stale app" },
    }).team;
    insertDeploy(live.id, "running", "2026-11-01T00:00:00Z");
    // running antigo seguido de stopped mais novo → último não é running
    insertDeploy(stale.id, "running", "2026-10-01T00:00:00Z");
    insertDeploy(stale.id, "stopped", "2026-10-02T00:00:00Z");

    const byId = Object.fromEntries(listProjects().map((c) => [c.teamId, c]));
    expect(byId[live.id].liveDeployId).toBeTruthy();
    expect(byId[stale.id].liveDeployId).toBeNull();
  });

  it("filtros combinam: hackathonId, liveOnly e os dois juntos", () => {
    const u = createTeam(UNIFACENS, {
      name: "U",
      placement: 0,
      project: { title: "u app" },
    }).team;
    const p = createTeam(PUC, {
      name: "P",
      placement: 0,
      project: { title: "p app" },
    }).team;
    insertDeploy(u.id, "running", "2026-11-01T00:00:00Z");

    expect(listProjects({ hackathonId: PUC }).map((c) => c.teamId)).toEqual([
      p.id,
    ]);
    expect(listProjects({ hackathonId: "edicao-inexistente" })).toEqual([]);
    expect(listProjects({ liveOnly: true }).map((c) => c.teamId)).toEqual([
      u.id,
    ]);
    expect(
      listProjects({ hackathonId: UNIFACENS, liveOnly: true }).map(
        (c) => c.teamId,
      ),
    ).toEqual([u.id]);
    expect(listProjects({ hackathonId: PUC, liveOnly: true })).toEqual([]);
  });

  it("liveOnly não ressuscita demo: último deploy failed esconde running antigo", () => {
    const t = createTeam(UNIFACENS, {
      name: "X",
      placement: 0,
      project: { title: "x app" },
    }).team;
    insertDeploy(t.id, "running", "2026-10-01T00:00:00Z");
    insertDeploy(t.id, "failed", "2026-10-02T00:00:00Z");
    expect(listProjects({ liveOnly: true })).toEqual([]);
  });
});

describe("listProjectEditions — chips do filtro", () => {
  it("só edições que têm projeto, mais recente primeiro", () => {
    createTeam(UNIFACENS, {
      name: "U",
      placement: 0,
      project: { title: "u app" },
    });
    createTeam(ANHEMBI, {
      name: "A",
      placement: 0,
      project: { title: "a app" },
    });
    const eds = listProjectEditions();
    expect(eds.map((e) => e.id)).toEqual([ANHEMBI, UNIFACENS]);
    expect(eds[0].name).toBeTruthy();
  });

  it("vazio quando nada tem projeto", () => {
    createTeam(UNIFACENS, { name: "SemProjeto", placement: 0 });
    expect(listProjectEditions()).toEqual([]);
  });
});
