import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import db from "@/lib/db";

// schema próprio (idempotente) — não edita lib/db.ts
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

// trava de ambiente: o deploy tool roda código de terceiros, e a VPS de
// produção divide máquina com outros serviços — sem HACKAHUB_DEPLOY_TOOL=on
// ele fica desligado e o toggle do admin não religa (spec 033, Produção)
export function deployToolAllowed(): boolean {
  return process.env.HACKAHUB_DEPLOY_TOOL === "on";
}

export async function deploysEnabled(): Promise<boolean> {
  if (!deployToolAllowed()) return false;
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'deploys_enabled'")
    .get() as { value: string } | undefined;
  return row?.value !== "0";
}

export async function setDeploysEnabled(on: boolean) {
  if (on && !deployToolAllowed()) {
    throw new Error("Deploy tool desligado neste ambiente (HACKAHUB_DEPLOY_TOOL)");
  }
  await db.prepare(
    "INSERT INTO settings (key, value) VALUES ('deploys_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(on ? "1" : "0");
}

export async function canDeploy(
  member: { username: string; role: string } | null,
  teamId: number,
): Promise<boolean> {
  if (!member) return false;
  if (member.role === "admin") return true;
  return !!await db
    .prepare("SELECT 1 FROM team_members WHERE teamId = ? AND username = ?")
    .get(teamId, member.username);
}

/** fixture helper também usado nos testes: cria team + project mínimos */
export async function createProjectFixture(
  hackathonId: string,
  opts: { name?: string; repoUrl?: string } = {},
): Promise<number> {
  const name = opts.name ?? `team-${crypto.randomBytes(3).toString("hex")}`;
  const res = await db
    .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)")
    .run(hackathonId, name);
  const teamId = Number(res.lastInsertRowid);
  await db.prepare(
    "INSERT INTO team_projects (teamId, title, description, repoUrl, demoUrl) VALUES (?, ?, '', ?, NULL)",
  ).run(teamId, `${name} app`, opts.repoUrl ?? "https://github.com/org/repo");
  return teamId;
}

export async function getDeploy(id: string): Promise<Deploy | null> {
  return (
    (await db.prepare("SELECT * FROM deploys WHERE id = ?").get(id) as
      | Deploy
      | undefined) ?? null
  );
}

export async function getDeployForTeam(teamId: number): Promise<Deploy | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM deploys WHERE teamId = ?
         AND status IN ('queued','building','running')
         ORDER BY createdAt DESC LIMIT 1`,
      )
      .get(teamId) as Deploy | undefined) ?? null
  );
}

/** último deploy do projeto, qualquer status — o GET mostra stopped/failed */
export async function getLatestDeployForTeam(teamId: number): Promise<Deploy | null> {
  return (
    (await db
      .prepare(
        "SELECT * FROM deploys WHERE teamId = ? ORDER BY createdAt DESC LIMIT 1",
      )
      .get(teamId) as Deploy | undefined) ?? null
  );
}

export async function activeDeployCount(): Promise<number> {
  const r = await db
    .prepare(
      "SELECT COUNT(*) n FROM deploys WHERE status IN ('queued','building','running')",
    )
    .get() as { n: number };
  return r.n;
}

export async function listDeploys(): Promise<Deploy[]> {
  return await db
    .prepare("SELECT * FROM deploys ORDER BY createdAt DESC LIMIT 100")
    .all() as Deploy[];
}

export async function projectExists(teamId: number): Promise<boolean> {
  return !!await db
    .prepare("SELECT 1 FROM team_projects WHERE teamId = ?")
    .get(teamId);
}

export async function projectRepoUrl(teamId: number): Promise<string | null> {
  const r = await db
    .prepare("SELECT repoUrl FROM team_projects WHERE teamId = ?")
    .get(teamId) as { repoUrl: string | null } | undefined;
  return r?.repoUrl ?? null;
}

/** valida e insere o deploy; o runner detached faz o resto */
export async function queueDeploy(input: {
  teamId: number;
  repoUrl?: string;
  startCommand?: string;
  byUsername: string;
}): Promise<Deploy> {
  if (!await deploysEnabled()) throw new Error("Deploys desativados pelo admin");
  if (!await projectExists(input.teamId)) throw new Error("Projeto não encontrado");
  if (await getDeployForTeam(input.teamId))
    throw new Error("Já existe um deploy ativo pra esse projeto");
  if (await activeDeployCount() >= MAX_ACTIVE_DEPLOYS)
    throw new Error(`Limite de ${MAX_ACTIVE_DEPLOYS} demos simultâneas atingido`);

  const repoUrl = (input.repoUrl ?? await projectRepoUrl(input.teamId) ?? "").trim();
  const invalid = validateRepoUrl(repoUrl);
  if (invalid) throw new Error(invalid);

  const id = crypto.randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + DEPLOY_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO deploys (id, teamId, repoUrl, status, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
  ).run(id, input.teamId, repoUrl, expiresAt, now(), now());

  spawnRunner(id, input.startCommand);
  return (await getDeploy(id))!;
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
      env: process.env,
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

export async function stopDeploy(id: string, status: DeployStatus = "stopped") {
  const d = await getDeploy(id);
  if (!d) return;
  try {
    if (d.containerName) docker(["rm", "-f", d.containerName]);
    docker(["rmi", "-f", `hackahub-demo-${id}`]);
  } catch {
    /* container/imagem podem não existir — best-effort */
  }
  await db.prepare(
    "UPDATE deploys SET status = ?, updatedAt = ? WHERE id = ?",
  ).run(status, now(), id);
}

/** expira TTL e reconcilia containers mortos — roda a cada leitura */
export async function sweepDeploys() {
  const active = await db
    .prepare(
      "SELECT id, expiresAt, containerName, status FROM deploys WHERE status IN ('queued','building','running')",
    )
    .all() as Pick<Deploy, "id" | "expiresAt" | "containerName" | "status">[];
  for (const d of active) {
    if (new Date(d.expiresAt).getTime() < Date.now()) {
      await stopDeploy(d.id, "expired");
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
          await db.prepare(
            "UPDATE deploys SET status = 'failed', error = 'container morreu', updatedAt = ? WHERE id = ?",
          ).run(now(), d.id);
        }
      } catch {
        await db.prepare(
          "UPDATE deploys SET status = 'failed', error = 'container sumiu', updatedAt = ? WHERE id = ?",
        ).run(now(), d.id);
      }
    }
  }
}

export async function proxyTarget(id: string): Promise<number | null> {
  await sweepDeploys();
  const d = await getDeploy(id);
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
