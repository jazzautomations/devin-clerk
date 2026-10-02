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
} from "@/lib/deploys";

function ensureMember(username: string, role = "member") {
  db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email, role)
     VALUES (?, ?, ?, ?)`,
  ).run(`clerk-${username}`, username, `${username}@x.dev`, role);
}

beforeEach(() => {
  db.exec("DELETE FROM deploys");
  db.exec("DELETE FROM team_members");
  db.exec("DELETE FROM team_projects");
  db.exec("DELETE FROM teams");
  db.exec("DELETE FROM settings WHERE key = 'deploys_enabled'");
  ensureMember("dev1");
  ensureMember("boss", "admin");
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
  it("membro do time pode; estranho não; admin pode", () => {
    const teamId = createProjectFixture("hack-inova-alphaville-2026");
    db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, "dev1");
    expect(canDeploy({ username: "dev1", role: "member" }, teamId)).toBe(true);
    expect(canDeploy({ username: "boss", role: "admin" }, teamId)).toBe(true);
    ensureMember("random");
    expect(canDeploy({ username: "random", role: "member" }, teamId)).toBe(false);
  });
});

describe("queueDeploy", () => {
  it("cria deploy queued com TTL e repo do projeto", () => {
    const teamId = createProjectFixture("hack-inova-alphaville-2026", {
      repoUrl: "https://github.com/org/demo",
    });
    db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, "dev1");
    const d = queueDeploy({ teamId, byUsername: "dev1" });
    expect(d.status).toBe("queued");
    expect(d.repoUrl).toBe("https://github.com/org/demo");
    expect(new Date(d.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejeita segundo deploy ativo pro mesmo projeto", () => {
    const teamId = createProjectFixture("hack-inova-alphaville-2026");
    queueDeploy({ teamId, byUsername: "dev1" });
    expect(() => queueDeploy({ teamId, byUsername: "dev1" })).toThrow(/já existe/i);
  });

  it("rejeita quando quota global cheia", () => {
    for (let i = 0; i < 3; i++) {
      const t = createProjectFixture("hack-inova-alphaville-2026", { name: `t${i}` });
      db.prepare(
        "INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)",
      ).run(`d${i}`, t, "https://github.com/o/r", "running", new Date(Date.now() + 9e5).toISOString(), "x", "x");
    }
    const teamId = createProjectFixture("hack-inova-alphaville-2026", { name: "extra" });
    expect(() => queueDeploy({ teamId, byUsername: "dev1" })).toThrow(/limite/i);
    expect(activeDeployCount()).toBe(3);
  });

  it("kill-switch desligado bloqueia", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('deploys_enabled','0')").run();
    expect(deploysEnabled()).toBe(false);
    const teamId = createProjectFixture("hack-inova-alphaville-2026");
    expect(() => queueDeploy({ teamId, byUsername: "dev1" })).toThrow(/desativad/i);
  });
});

describe("sweep/stop", () => {
  it("expira deploy vencido", () => {
    const teamId = createProjectFixture("hack-inova-alphaville-2026");
    db.prepare(
      "INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)",
    ).run("old", teamId, "https://github.com/o/r", "running", new Date(Date.now() - 1000).toISOString(), "x", "x");
    sweepDeploys();
    expect(getDeploy("old")!.status).toBe("expired");
  });
  it("stopDeploy marca stopped", () => {
    const teamId = createProjectFixture("hack-inova-alphaville-2026");
    const d = queueDeploy({ teamId, byUsername: "dev1" });
    stopDeploy(d.id);
    expect(getDeploy(d.id)!.status).toBe("stopped");
  });
});
