import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import db from "@/lib/db";

// migration 031 roda de novo sem erro (IF NOT EXISTS: a branch de bloqueio e
// denúncia também cria notifications.actorId) e o backfill respeita conta
// excluída e @ antigo.

const sql = readFileSync(join(process.cwd(), "migrations/031_evidencia_lgpd.sql"), "utf8");

async function member(tag: string, clerkId = `clerk_${tag}`) {
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email, createdAt) VALUES (?, ?, ?, '2024-05-01 10:00:00') RETURNING id")
    .get<{ id: number }>(clerkId, `u_${tag}`, `${tag}@t.dev`);
  return r!.id;
}

describe("migration 031", () => {
  it("rodar de novo não quebra; lastSeenAt só pra conta viva", async () => {
    const viva = await member("m31a");
    const excluida = await member("m31b", "deleted:m31b");
    await db.prepare(`UPDATE members SET "lastSeenAt" = NULL WHERE id IN (?, ?)`).run(viva, excluida);
    await db.exec(sql);
    await db.exec(sql);
    const rows = await db
      .prepare(`SELECT id, "lastSeenAt" FROM members WHERE id IN (?, ?) ORDER BY id`)
      .all<{ id: number; lastSeenAt: string | null }>(viva, excluida);
    expect(rows).toEqual([
      { id: viva, lastSeenAt: "2024-05-01 10:00:00" },
      { id: excluida, lastSeenAt: null },
    ]);
  });

  it("actorId casa pelo @ atual e pelo @ antigo de username_redirects", async () => {
    const ana = await member("m31c");
    const bia = await member("m31d");
    await db.prepare(`INSERT INTO username_redirects ("oldUsername", "memberId") VALUES ('m31c_velho', ?)`).run(ana);
    const ins = db.prepare(
      `INSERT INTO notifications ("memberId", "actorUsername", type, text) VALUES (?, ?, 'like', 'x') RETURNING id`,
    );
    const atual = (await ins.get<{ id: number }>(bia, "u_m31c"))!.id;
    const velho = (await ins.get<{ id: number }>(bia, "m31c_velho"))!.id;
    const ninguem = (await ins.get<{ id: number }>(bia, "m31_ninguem"))!.id;
    await db.prepare(`UPDATE notifications SET "actorId" = NULL WHERE id IN (?, ?, ?)`).run(atual, velho, ninguem);
    await db.exec(sql);
    const rows = await db
      .prepare(`SELECT id, "actorId" FROM notifications WHERE id IN (?, ?, ?) ORDER BY id`)
      .all<{ id: number; actorId: number | null }>(atual, velho, ninguem);
    expect(rows).toEqual([
      { id: atual, actorId: ana },
      { id: velho, actorId: ana },
      { id: ninguem, actorId: null },
    ]);
  });
});
