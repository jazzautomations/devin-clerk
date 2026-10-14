// deploy-runner — processo detached que executa clone→build→run→healthcheck.
// Uso: node scripts/deploy-runner.mjs <deployId> [startCommand]
// Atualiza a linha do deploy direto no Postgres (DATABASE_URL).

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const [deployId, startCommand] = process.argv.slice(2);
const ROOT = process.cwd();
const WORK = path.join(ROOT, "data", "deploys", deployId);
const REPO_DIR = path.join(WORK, "repo");
const CONTAINER_PORT = 8080;

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const now = () => new Date().toISOString();
const set = async (patch) => {
  const keys = Object.keys(patch);
  await db.query(
    `UPDATE deploys SET ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ")},
       "updatedAt" = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
    [...keys.map((k) => patch[k]), now(), deployId],
  );
};
const fail = async (err) => {
  console.error("[deploy] FAILED:", err.message ?? err);
  await set({ status: "failed", error: String(err.message ?? err).slice(-400) });
  await db.end();
  process.exit(1);
};

const sh = (cmd, opts = {}) => execSync(cmd, { cwd: WORK, stdio: "inherit", ...opts });
const docker = (args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

const deploy = (await db.query("SELECT * FROM deploys WHERE id = $1", [deployId])).rows[0];
if (!deploy) await fail(new Error("deploy não encontrado"));

fs.mkdirSync(WORK, { recursive: true });

await set({ status: "building" });

// 1. clone público
try {
  sh(`git clone --depth 1 ${JSON.stringify(deploy.repoUrl)} ${JSON.stringify(REPO_DIR)}`);
} catch {
  await fail(new Error("clone falhou — repo privado ou inexistente?"));
}

// 2. stack detection → Dockerfile
const hasDockerfile = fs.existsSync(path.join(REPO_DIR, "Dockerfile"));
const hasPkg = fs.existsSync(path.join(REPO_DIR, "package.json"));
const hasIndex = fs.existsSync(path.join(REPO_DIR, "index.html"));

if (!hasDockerfile) {
  let df;
  if (startCommand) {
    df = `FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nENV PORT=${CONTAINER_PORT}\nEXPOSE ${CONTAINER_PORT}\nCMD ${JSON.stringify(startCommand)}`;
  } else if (hasPkg) {
    df = `FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install --no-audit --no-fund\nRUN npm run build --if-present || true\nENV PORT=${CONTAINER_PORT}\nEXPOSE ${CONTAINER_PORT}\nCMD ["sh","-c","npm start"]`;
  } else if (hasIndex) {
    df = `FROM python:3.12-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE ${CONTAINER_PORT}\nCMD ["python","-m","http.server","${CONTAINER_PORT}"]`;
  } else {
    await fail(new Error("stack não detectada — mande Dockerfile ou startCommand"));
  }
  fs.writeFileSync(path.join(REPO_DIR, "Dockerfile"), df);
}

// 3. build
const image = `hackahub-demo-${deployId}`;
try {
  sh(`docker build -t ${image} ${JSON.stringify(REPO_DIR)}`, { cwd: REPO_DIR });
} catch {
  await fail(new Error("docker build falhou — veja o log"));
}

// 4. run isolado (publish só em 127.0.0.1 — inbound só via proxy do app)
const cname = `hackahub-demo-${deployId}`;
try {
  docker([
    "run", "-d", "--name", cname,
    "--memory=256m", "--cpus=0.5", "--pids-limit=64",
    "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:size=64m",
    "-e", `PORT=${CONTAINER_PORT}`,
    "-p", `127.0.0.1:0:${CONTAINER_PORT}`,
    image,
  ]);
} catch (e) {
  await fail(new Error(`docker run falhou: ${e.message?.slice(-200)}`));
}
await set({ containerName: cname });

// 5. porta real + health check (até ~90s)
const portLine = docker(["port", cname, `${CONTAINER_PORT}/tcp`]);
const port = Number((portLine.match(/:(\d+)/) ?? [])[1]);
if (!port) await fail(new Error("porta não publicada"));

const base = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(3000) });
    if (r.status < 500) { up = true; break; }
  } catch { /* ainda subindo */ }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!up) {
  try { docker(["rm", "-f", cname]); } catch {}
  await fail(new Error("app não respondeu na porta 8080 em 90s"));
}

await set({ status: "running", port });
console.log(`[deploy] live: ${base} → /demo/${deployId}/`);
await db.end();
process.exit(0);
