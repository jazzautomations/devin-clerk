// deploy/smoke.sh decide se o deploy volta sozinho: testa contra um servidor
// HTTP falso e um psql falso, sem Docker nem banco.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SMOKE = join(process.cwd(), "deploy/smoke.sh");
let dir = "";
let fakePsql = "";
let psqlLog = "";
let mode: "prod" | "stage" = "prod";
let server: http.Server;
let base = "";
const hits: string[] = [];

const ROBOTS = {
  prod: "User-Agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n",
  stage: "User-Agent: *\nDisallow: /\n",
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "smoke-"));
  psqlLog = join(dir, "psql.log");
  fakePsql = join(dir, "psql");
  // devolve a edição 7 só pra consulta que filtra edição ativa
  writeFileSync(
    fakePsql,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${psqlLog}\ncase "$*" in *"FROM hackathons WHERE active = 1"*) echo 7 ;; esac\n`,
    { mode: 0o755 },
  );
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    hits.push(url);
    const headers: Record<string, string> = {};
    if (mode === "stage") headers["X-Robots-Tag"] = "noindex, nofollow";
    if (url === "/robots.txt") {
      res.writeHead(200, { ...headers, "Content-Type": "text/plain" });
      return res.end(ROBOTS[mode]);
    }
    if (url === "/p/2147483648") {
      res.writeHead(404, headers);
      return res.end();
    }
    const png = url.endsWith("opengraph-image");
    res.writeHead(200, { ...headers, "Content-Type": png ? "image/png" : "text/html; charset=utf-8" });
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function smoke(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [SMOKE, base, ...args],
      { env: { ...process.env, SMOKE_PSQL: fakePsql } },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, out: stdout + stderr });
      },
    );
  });
}

describe("deploy/smoke.sh", () => {
  it("testa só edição ativa em /h (rascunho daria 404 e rollback)", async () => {
    mode = "prod";
    hits.length = 0;
    const r = await smoke("hackahub_e2e", "prod");
    expect(r.code).toBe(0);
    expect(readFileSync(psqlLog, "utf8")).toContain("WHERE active = 1");
    expect(hits).toContain("/h/7");
  });

  it("prod aberto pra busca passa", async () => {
    mode = "prod";
    const r = await smoke("", "prod");
    expect(r.code).toBe(0);
    expect(r.out).toContain("prod aberto pra busca");
  });

  it("prod fechado pra busca (SITE_URL errado no build) falha", async () => {
    mode = "stage";
    const r = await smoke("", "prod");
    expect(r.code).toBe(1);
    expect(r.out).toContain("prod fechado pra busca");
  });

  it("stage fechado passa e stage aberto falha", async () => {
    mode = "stage";
    expect((await smoke("", "stage")).code).toBe(0);
    mode = "prod";
    const r = await smoke("", "stage");
    expect(r.code).toBe(1);
    expect(r.out).toContain("stage aberto pra busca");
  });

  it("sem ambiente não confere indexação", async () => {
    mode = "stage";
    const r = await smoke();
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("pra busca");
  });
});
