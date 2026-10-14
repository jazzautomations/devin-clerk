import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFileSync: vi.fn(() => ""),
}));

import db from "@/lib/db";
import {
  activeDeployCount,
  canDeploy,
  createProjectFixture,
  deploysEnabled,
  getDeploy,
  queueDeploy,
  stopDeploy,
  sweepDeploys,
  validateRepoUrl,
  deployToolAllowed,
  setDeploysEnabled,
} from "@/lib/deploys";

async function ensureMember(username: string, role = "member") {
  await db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email, role)
     VALUES (?, ?, ?, ?)`,
  ).run(`clerk-${username}`, username, `${username}@x.dev`, role);
}

beforeEach(async () => {
  await db.exec("DELETE FROM deploys");
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
  await db.exec("DELETE FROM settings WHERE key = 'deploys_enabled'");
  await ensureMember("dev1");
  await ensureMember("boss", "admin");
});

describe("validateRepoUrl", () => {
  it("aceita github público https", () => {
    expect(validateRepoUrl("https://github.com/org/repo")).toBeNull();
  });
  it("rejeita não-github e ssh", () => {
    expect(validateRepoUrl("https://gitlab.com/o/r")).toBeTruthy();
    expect(validateRepoUrl("git@github.com:o/r.git")).toBeTruthy();
    expect(validateRepoUrl("ftp://x")).toBeTruthy();
  });
});

describe("canDeploy", () => {
  it("membro do time pode; estranho não; admin pode", async () => {
    const teamId = await createProjectFixture("hack-inova-alphaville-2026");
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, "dev1");
    expect(await canDeploy({ username: "dev1", role: "member" }, teamId)).toBe(true);
    expect(await canDeploy({ username: "boss", role: "admin" }, teamId)).toBe(true);
    await ensureMember("random");
    expect(await canDeploy({ username: "random", role: "member" }, teamId)).toBe(false);
  });
});

describe("queueDeploy", () => {
  it("cria deploy queued com TTL e repo do projeto", async () => {
    const teamId = await createProjectFixture("hack-inova-alphaville-2026", {
      repoUrl: "https://github.com/org/demo",
    });
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, "dev1");
    const d = await queueDeploy({ teamId, byUsername: "dev1" });
    expect(d.status).toBe("queued");
    expect(d.repoUrl).toBe("https://github.com/org/demo");
    expect(new Date(d.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejeita segundo deploy ativo pro mesmo projeto", async () => {
    const teamId = await createProjectFixture("hack-inova-alphaville-2026");
    await queueDeploy({ teamId, byUsername: "dev1" });
    await expect(queueDeploy({ teamId, byUsername: "dev1" })).rejects.toThrow(/já existe/i);
  });

  it("rejeita quando quota global cheia", async () => {
    for (let i = 0; i < 3; i++) {
      const t = await createProjectFixture("hack-inova-alphaville-2026", { name: `t${i}` });
      await db.prepare(
        "INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)",
      ).run(`d${i}`, t, "https://github.com/o/r", "running", new Date(Date.now() + 9e5).toISOString(), "x", "x");
    }
    const teamId = await createProjectFixture("hack-inova-alphaville-2026", { name: "extra" });
    await expect(queueDeploy({ teamId, byUsername: "dev1" })).rejects.toThrow(/limite/i);
    expect(await activeDeployCount()).toBe(3);
  });

  it("kill-switch desligado bloqueia", async () => {
    await db.prepare("INSERT INTO settings (key, value) VALUES ('deploys_enabled','0')").run();
    expect(await deploysEnabled()).toBe(false);
    const teamId = await createProjectFixture("hack-inova-alphaville-2026");
    await expect(queueDeploy({ teamId, byUsername: "dev1" })).rejects.toThrow(/desativad/i);
  });
});

describe("sweep/stop", () => {
  it("expira deploy vencido", async () => {
    const teamId = await createProjectFixture("hack-inova-alphaville-2026");
    await db.prepare(
      "INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)",
    ).run("old", teamId, "https://github.com/o/r", "running", new Date(Date.now() - 1000).toISOString(), "x", "x");
    await sweepDeploys();
    expect((await getDeploy("old"))!.status).toBe("expired");
  });
  it("stopDeploy marca stopped", async () => {
    const teamId = await createProjectFixture("hack-inova-alphaville-2026");
    const d = await queueDeploy({ teamId, byUsername: "dev1" });
    await stopDeploy(d.id);
    expect((await getDeploy(d.id))!.status).toBe("stopped");
  });
});

describe("trava de ambiente (HACKAHUB_DEPLOY_TOOL)", () => {
  it("sem a env o deploy tool fica desligado e o admin não religa", async () => {
    vi.stubEnv("HACKAHUB_DEPLOY_TOOL", "");
    try {
      expect(deployToolAllowed()).toBe(false);
      await setDeploysEnabled(true).catch(() => {});
      expect(await deploysEnabled()).toBe(false);
      await expect(setDeploysEnabled(true)).rejects.toThrow(/desligado/);
      // desligar continua permitido
      await expect(setDeploysEnabled(false)).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("DeployPanel some quando a publicação de demos está desligada", () => {
  it("sem HACKAHUB_DEPLOY_TOOL=on não renderiza nada", async () => {
    const { DeployPanel } = await import("@/components/DeployPanel");
    vi.stubEnv("HACKAHUB_DEPLOY_TOOL", "");
    expect(await DeployPanel({ teamId: 1, canDeploy: true, hasRepo: true })).toBeNull();
    vi.unstubAllEnvs();
  });

  it("ligado renderiza o painel", async () => {
    const { DeployPanel } = await import("@/components/DeployPanel");
    vi.stubEnv("HACKAHUB_DEPLOY_TOOL", "on");
    await setDeploysEnabled(true);
    expect(await DeployPanel({ teamId: 1, canDeploy: true, hasRepo: true })).not.toBeNull();
    vi.unstubAllEnvs();
  });
});
