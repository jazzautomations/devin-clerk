import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import "@/lib/deploys"; // garante a tabela deploys no :memory:
import { listProjectEditions, listProjects } from "@/lib/projects";

// edições do seed (datas crescentes):
const UNIFACENS = "hack-inova-unifacens-2026"; // 2026-08-17
const PUC = "hack-inova-puc-saude-2026"; // 2026-09-12
const ANHEMBI = "hackinova-os-2-anhembi-2026"; // 2026-09-22

async function makeMember(username: string): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
}

async function insertDeploy(
  teamId: number,
  status: string,
  createdAt: string,
): Promise<void> {
  await db.prepare(
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

beforeEach(async () => {
  await db.exec("DELETE FROM deploys");
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
});

describe("listProjects — índice público de projetos", () => {
  it("retorna [] quando nenhum time tem projeto", async () => {
    await createTeam(UNIFACENS, { name: "SemProjeto", placement: 0 });
    expect(await listProjects()).toEqual([]);
  });

  it("INNER JOIN: time sem projeto fica fora; card traz todos os campos", async () => {
    await makeMember("ana");
    await makeMember("bia");
    await createTeam(UNIFACENS, { name: "SemProjeto", placement: 0 });
    const { team } = await createTeam(UNIFACENS, {
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

    const list = await listProjects();
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
      videoUrl: null, // spec 030 — colunas novas voltam null no legado
      logoUrl: null,
    });
  });

  it("ordena: colocação crescente, participante (0) por último, edição recente desempata", async () => {
    const campeaAntiga = (await createTeam(UNIFACENS, {
      name: "W-old",
      placement: 1,
      project: { title: "w-old app" },
    })).team;
    const participanteNovo = (await createTeam(ANHEMBI, {
      name: "P-new",
      placement: 0,
      project: { title: "p-new app" },
    })).team;
    const participanteMeio = (await createTeam(PUC, {
      name: "P-mid",
      placement: 0,
      project: { title: "p-mid app" },
    })).team;
    const viceNovo = (await createTeam(ANHEMBI, {
      name: "W-new",
      placement: 2,
      project: { title: "w-new app" },
    })).team;

    const order = (await listProjects()).map((c) => c.teamId);
    // 1º lugar (mesmo da edição mais antiga) → 2º → participantes, edição recente primeiro
    expect(order).toEqual([
      campeaAntiga.id,
      viceNovo.id,
      participanteNovo.id,
      participanteMeio.id,
    ]);
  });

  it("liveDeployId só quando o ÚLTIMO deploy tá running — demo antiga parada não conta", async () => {
    const live = (await createTeam(UNIFACENS, {
      name: "Live",
      placement: 0,
      project: { title: "live app" },
    })).team;
    const stale = (await createTeam(UNIFACENS, {
      name: "Stale",
      placement: 0,
      project: { title: "stale app" },
    })).team;
    await insertDeploy(live.id, "running", "2026-11-01T00:00:00Z");
    // running antigo seguido de stopped mais novo → último não é running
    await insertDeploy(stale.id, "running", "2026-10-01T00:00:00Z");
    await insertDeploy(stale.id, "stopped", "2026-10-02T00:00:00Z");

    const byId = Object.fromEntries((await listProjects()).map((c) => [c.teamId, c]));
    expect(byId[live.id].liveDeployId).toBeTruthy();
    expect(byId[stale.id].liveDeployId).toBeNull();
  });

  it("paginação: limit/offset cortam a lista na mesma ordem (auditoria 041: n1-projetos-deploy-por-card)", async () => {
    const ids: number[] = [];
    for (const n of ["A", "B", "C"]) {
      ids.push((await createTeam(UNIFACENS, { name: n, placement: 0, project: { title: `${n} app` } })).team.id);
    }
    const all = (await listProjects()).map((c) => c.teamId);
    expect(all).toEqual(ids);
    expect((await listProjects({ limit: 2 })).map((c) => c.teamId)).toEqual(all.slice(0, 2));
    expect((await listProjects({ limit: 2, offset: 2 })).map((c) => c.teamId)).toEqual(all.slice(2));
  });

  it("filtros combinam: hackathonId, liveOnly e os dois juntos", async () => {
    const u = (await createTeam(UNIFACENS, {
      name: "U",
      placement: 0,
      project: { title: "u app" },
    })).team;
    const p = (await createTeam(PUC, {
      name: "P",
      placement: 0,
      project: { title: "p app" },
    })).team;
    await insertDeploy(u.id, "running", "2026-11-01T00:00:00Z");

    expect((await listProjects({ hackathonId: PUC })).map((c) => c.teamId)).toEqual([
      p.id,
    ]);
    expect(await listProjects({ hackathonId: "edicao-inexistente" })).toEqual([]);
    expect((await listProjects({ liveOnly: true })).map((c) => c.teamId)).toEqual([
      u.id,
    ]);
    expect(
      (await listProjects({ hackathonId: UNIFACENS, liveOnly: true })).map(
        (c) => c.teamId,
      ),
    ).toEqual([u.id]);
    expect(await listProjects({ hackathonId: PUC, liveOnly: true })).toEqual([]);
  });

  it("liveOnly não ressuscita demo: último deploy failed esconde running antigo", async () => {
    const t = (await createTeam(UNIFACENS, {
      name: "X",
      placement: 0,
      project: { title: "x app" },
    })).team;
    await insertDeploy(t.id, "running", "2026-10-01T00:00:00Z");
    await insertDeploy(t.id, "failed", "2026-10-02T00:00:00Z");
    expect(await listProjects({ liveOnly: true })).toEqual([]);
  });
});

describe("listProjectEditions — chips do filtro", () => {
  it("só edições que têm projeto, mais recente primeiro", async () => {
    await createTeam(UNIFACENS, {
      name: "U",
      placement: 0,
      project: { title: "u app" },
    });
    await createTeam(ANHEMBI, {
      name: "A",
      placement: 0,
      project: { title: "a app" },
    });
    const eds = await listProjectEditions();
    expect(eds.map((e) => e.id)).toEqual([ANHEMBI, UNIFACENS]);
    expect(eds[0].name).toBeTruthy();
  });

  it("vazio quando nada tem projeto", async () => {
    await createTeam(UNIFACENS, { name: "SemProjeto", placement: 0 });
    expect(await listProjectEditions()).toEqual([]);
  });
});
