import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { GET } from "@/app/api/health/route";
import { deepHealth, readCronFails, readVersion } from "@/lib/health";

const get = (q = "") => GET(new Request(`http://t/api/health${q}`));

describe("/api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("responde ok com a versão do release", async () => {
    vi.stubEnv("HACKAHUB_VERSION", "abc1234");
    const res = await get();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(typeof j.version).toBe("string");
    expect(j.backupAgeH).toBeUndefined();
  });

  it("?deep=1 traz backup, drill, fila, disco e falhas de cron", async () => {
    const dir = mkdtempSync(join(tmpdir(), "health-"));
    const logs = join(dir, "logs");
    mkdirSync(logs);
    const now = Date.now();
    writeFileSync(join(dir, "LAST_OK"), new Date(now - 3 * 3_600_000).toISOString());
    writeFileSync(join(logs, ".fail-deliveries-prod"), "4\n");
    writeFileSync(join(logs, ".fail-rsvp-prod"), "0\n");
    vi.stubEnv("HACKAHUB_BACKUP_DIR", dir);
    vi.stubEnv("HACKAHUB_LOG_DIR", logs);
    const j = await (await get("?deep=1")).json();
    expect(j.ok).toBe(true);
    expect(j.backupAgeH).toBeGreaterThanOrEqual(2.9);
    expect(j.backupAgeH).toBeLessThan(3.2);
    expect(j.drillAgeH).toBeNull();
    expect(j.cronFails).toEqual({ "deliveries-prod": 4 });
    expect(j.diskPct).toBeGreaterThan(0);
    expect(j.diskPct).toBeLessThanOrEqual(100);
  });

  it("fila parada aparece em minutos desde o aviso mais antigo", async () => {
    const t = "2026-01-01 10:00:00";
    await db.exec(`INSERT INTO members (clerkId, username, email) VALUES ('h1','h1','h1@t.dev')`);
    const m = await db.prepare("SELECT id FROM members WHERE clerkId = 'h1'").get<{ id: number }>();
    const h = await db.prepare("SELECT id FROM hackathons LIMIT 1").get<{ id: string }>();
    await db
      .prepare(`INSERT INTO announcements (hackathonId, audience, title, body, createdBy) VALUES (?, 'todos', 'a', 'b', ?)`)
      .run(h!.id, m!.id);
    const a = await db.prepare("SELECT id FROM announcements LIMIT 1").get<{ id: number }>();
    await db
      .prepare(`INSERT INTO deliveries (announcementId, memberId, channel, status, createdAt) VALUES (?, ?, 'email', 'queued', ?)`)
      .run(a!.id, m!.id, t);
    const deep = await deepHealth(Date.parse("2026-01-01T10:30:00Z"));
    expect(deep.oldestQueuedDeliveryMin).toBe(30);
    expect(deep.oldestQueuedTicketMin).toBeNull();
  });

  it("sem arquivo VERSION cai na env ou em dev", () => {
    vi.stubEnv("HACKAHUB_VERSION", "");
    expect(readVersion("/nao/existe")).toBe("dev");
    const dir = mkdtempSync(join(tmpdir(), "ver-"));
    writeFileSync(join(dir, "VERSION"), "4c4871b 2026-10-14T12:00:00Z\n");
    expect(readVersion(dir)).toBe("4c4871b 2026-10-14T12:00:00Z");
    expect(readCronFails("/nao/existe")).toEqual({});
  });
});
