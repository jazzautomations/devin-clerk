import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import db from "@/lib/db";

// schema próprio (idempotente) — não edita lib/db.ts
db.exec(`CREATE TABLE IF NOT EXISTS deploys (
  id TEXT PRIMARY KEY,
  teamId INTEGER NOT NULL,
  repoUrl TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','building','running','failed','stopped','expired')),
  port INTEGER,
  containerName TEXT,
  expiresAt TEXT NOT NULL,
  error TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
)`);
db.exec(
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
);
db.exec("CREATE INDEX IF NOT EXISTS idx_deploys_team ON deploys(teamId)");
db.exec("CREATE INDEX IF NOT EXISTS idx_deploys_status ON deploys(status)");

export const DEPLOY_TTL_MS = 72 * 3600 * 1000;
export const MAX_ACTIVE_DEPLOYS = 3;
const DEPLOYS_DIR = path.join(process.cwd(), "data", "deploys");

export type DeployStatus =
  | "queued"
  | "building"
  | "running"
  | "failed"
  | "stopped"
  | "expired";

export type Deploy = {
  id: string;
  teamId: number;
  repoUrl: string;
  status: DeployStatus;
  port: number | null;
  containerName: string | null;
  expiresAt: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const now = () => new Date().toISOString();

export function validateRepoUrl(u: string): string | null {
  const url = (u ?? "").trim();
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url))
    return "repoUrl deve ser https://github.com/org/repo público";
  return null;
}

export function deploysEnabled(): boolean {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'deploys_enabled'")
    .get() as { value: string } | undefined;
  return row?.value !== "0";
}

export function setDeploysEnabled(on: boolean) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('deploys_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(on ? "1" : "0");
}

export function canDeploy(
  member: { username: string; role: string } | null,
  teamId: number,
): boolean {
  if (!member) return false;
  if (member.role === "admin") return true;
  return !!db
    .prepare("SELECT 1 FROM team_members WHERE teamId = ? AND username = ?")
    .get(teamId, member.username);
}

/** fixture helper também usado nos testes: cria team + project mínimos */
export function createProjectFixture(
  hackathonId: string,
  opts: { name?: string; repoUrl?: string } = {},
): number {
  const name = opts.name ?? `team-${crypto.randomBytes(3).toString("hex")}`;
  const res = db
    .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)")
    .run(hackathonId, name);
  const teamId = Number(res.lastInsertRowid);
  db.prepare(
    "INSERT INTO team_projects (teamId, title, description, repoUrl, demoUrl) VALUES (?, ?, '', ?, NULL)",
  ).run(teamId, `${name} app`, opts.repoUrl ?? "https://github.com/org/repo");
  return teamId;
}

export function getDeploy(id: string): Deploy | null {
  return (
    (db.prepare("SELECT * FROM deploys WHERE id = ?").get(id) as
      | Deploy
      | undefined) ?? null
  );
}

export function getDeployForTeam(teamId: number): Deploy | null {
  return (
    (db
      .prepare(
        `SELECT * FROM deploys WHERE teamId = ?
         AND status IN ('queued','building','running')
         ORDER BY createdAt DESC LIMIT 1`,
      )
      .get(teamId) as Deploy | undefined) ?? null
  );
}

/** último deploy do projeto, qualquer status — o GET mostra stopped/failed */
export function getLatestDeployForTeam(teamId: number): Deploy | null {
  return (
    (db
      .prepare(
        "SELECT * FROM deploys WHERE teamId = ? ORDER BY createdAt DESC LIMIT 1",
      )
      .get(teamId) as Deploy | undefined) ?? null
  );
}

export function activeDeployCount(): number {
  const r = db
    .prepare(
      "SELECT COUNT(*) n FROM deploys WHERE status IN ('queued','building','running')",
    )
    .get() as { n: number };
  return r.n;
}

export function listDeploys(): Deploy[] {
  return db
    .prepare("SELECT * FROM deploys ORDER BY createdAt DESC LIMIT 100")
    .all() as Deploy[];
}

export function projectExists(teamId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM team_projects WHERE teamId = ?")
    .get(teamId);
}

export function projectRepoUrl(teamId: number): string | null {
  const r = db
    .prepare("SELECT repoUrl FROM team_projects WHERE teamId = ?")
    .get(teamId) as { repoUrl: string | null } | undefined;
  return r?.repoUrl ?? null;
}

/** valida e insere o deploy; o runner detached faz o resto */
export function queueDeploy(input: {
  teamId: number;
  repoUrl?: string;
  startCommand?: string;
  byUsername: string;
}): Deploy {
  if (!deploysEnabled()) throw new Error("Deploys desativados pelo admin");
  if (!projectExists(input.teamId)) throw new Error("Projeto não encontrado");
  if (getDeployForTeam(input.teamId))
    throw new Error("Já existe um deploy ativo pra esse projeto");
  if (activeDeployCount() >= MAX_ACTIVE_DEPLOYS)
    throw new Error(`Limite de ${MAX_ACTIVE_DEPLOYS} demos simultâneas atingido`);

  const repoUrl = (input.repoUrl ?? projectRepoUrl(input.teamId) ?? "").trim();
  const invalid = validateRepoUrl(repoUrl);
  if (invalid) throw new Error(invalid);

  const id = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + DEPLOY_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
  ).run(id, input.teamId, repoUrl, expiresAt, now(), now());

  spawnRunner(id, input.startCommand);
  return getDeploy(id)!;
}

function spawnRunner(deployId: string, startCommand?: string) {
  fs.mkdirSync(path.join(DEPLOYS_DIR, deployId), { recursive: true });
  const logFd = fs.openSync(
    path.join(DEPLOYS_DIR, deployId, "build.log"),
    "w",
  );
  const child = spawn(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "deploy-runner.mjs"),
      deployId,
      startCommand ?? "",
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        HACKAHUB_DB: process.env.HACKAHUB_DB ?? "data/hackahub.db",
      },
    },
  );
  child.unref();
  fs.closeSync(logFd);
}

function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 30_000,
  }).trim();
}

export function stopDeploy(id: string, status: DeployStatus = "stopped") {
  const d = getDeploy(id);
  if (!d) return;
  try {
    if (d.containerName) docker(["rm", "-f", d.containerName]);
    docker(["rmi", "-f", `hackahub-demo-${id}`]);
  } catch {
    /* container/imagem podem não existir — best-effort */
  }
  db.prepare(
    "UPDATE deploys SET status = ?, updatedAt = ? WHERE id = ?",
  ).run(status, now(), id);
}

/** expira TTL e reconcilia containers mortos — roda a cada leitura */
export function sweepDeploys() {
  const active = db
    .prepare(
      "SELECT id, expiresAt, containerName, status FROM deploys WHERE status IN ('queued','building','running')",
    )
    .all() as Pick<Deploy, "id" | "expiresAt" | "containerName" | "status">[];
  for (const d of active) {
    if (new Date(d.expiresAt).getTime() < Date.now()) {
      stopDeploy(d.id, "expired");
      continue;
    }
    if (d.status === "running" && d.containerName) {
      try {
        const state = docker([
          "inspect",
          "-f",
          "{{.State.Running}}",
          d.containerName,
        ]);
        if (state !== "true") {
          db.prepare(
            "UPDATE deploys SET status = 'failed', error = 'container morreu', updatedAt = ? WHERE id = ?",
          ).run(now(), d.id);
        }
      } catch {
        db.prepare(
          "UPDATE deploys SET status = 'failed', error = 'container sumiu', updatedAt = ? WHERE id = ?",
        ).run(now(), d.id);
      }
    }
  }
}

export function proxyTarget(id: string): number | null {
  sweepDeploys();
  const d = getDeploy(id);
  return d?.status === "running" && d.port ? d.port : null;
}

export function logTail(id: string, lines = 200): string {
  try {
    const p = path.join(DEPLOYS_DIR, id, "build.log");
    return fs.readFileSync(p, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}
