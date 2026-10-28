import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { alreadyNotified, listNotifications, notify } from "@/lib/notifications";

// notifications.actorId (migration 031): "não notificar a si mesmo" e a regra
// "1 por par" (alreadyNotified) usam o id, então trocar de @ não fura.

let seq = 0;
async function member() {
  const t = `na${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`);
  return { id: r!.id, username: `u_${t}` };
}

describe("notify com actorId", () => {
  it("grava o id do ator; sem actorId, resolve pelo @", async () => {
    const ana = await member();
    const bia = await member();
    await notify(ana.id, { type: "follow", actorId: bia.id, actorUsername: bia.username, text: "seguiu você", href: "/u/x" });
    await notify(ana.id, { type: "like", actorUsername: bia.username, text: "curtiu" });
    await notify(ana.id, { type: "sistema", text: "aviso" });
    const list = await listNotifications(ana.id);
    expect(list.map((n) => [n.type, n.actorId])).toEqual([
      ["sistema", null],
      ["like", bia.id],
      ["follow", bia.id],
    ]);
  });

  it("não notifica a si mesmo, pelo id (mesmo com @ diferente) ou pelo @", async () => {
    const ana = await member();
    await notify(ana.id, { type: "x", actorId: ana.id, actorUsername: "outro_arroba", text: "t" });
    await notify(ana.id, { type: "x", actorUsername: ana.username, text: "t" });
    expect(await listNotifications(ana.id)).toEqual([]);
  });
});

describe("alreadyNotified", () => {
  it("1 por par: trocar de @ não fura", async () => {
    const ana = await member();
    const bia = await member();
    expect(await alreadyNotified(ana.id, "follow", bia.id, "/u/b", null)).toBe(false);
    await notify(ana.id, { type: "follow", actorId: bia.id, actorUsername: bia.username, text: "seguiu", href: "/u/b" });
    expect(await alreadyNotified(ana.id, "follow", bia.id, "/u/b", null)).toBe(true);

    await db.prepare("UPDATE members SET username = 'bia_nova' WHERE id = ?").run(bia.id);
    // o @ novo, resolvido pelo notify, cai no mesmo id
    expect(await alreadyNotified(ana.id, "follow", bia.id, "/u/b", null)).toBe(true);
    await notify(ana.id, { type: "like", actorUsername: "bia_nova", text: "curtiu" });
    expect(await alreadyNotified(ana.id, "like", bia.id, null, null)).toBe(true);
  });

  it("separa tipo, href, destinatário e ator", async () => {
    const ana = await member();
    const bia = await member();
    const caio = await member();
    await notify(ana.id, { type: "follow", actorId: bia.id, text: "seguiu", href: "/u/b" });
    expect(await alreadyNotified(ana.id, "like", bia.id, "/u/b", null)).toBe(false);
    expect(await alreadyNotified(ana.id, "follow", bia.id, "/u/c", null)).toBe(false);
    expect(await alreadyNotified(ana.id, "follow", bia.id, null, null)).toBe(false);
    expect(await alreadyNotified(caio.id, "follow", bia.id, "/u/b", null)).toBe(false);
    expect(await alreadyNotified(ana.id, "follow", caio.id, "/u/b", null)).toBe(false);
  });

  it("sinceDays limita a janela; null olha a história inteira", async () => {
    const ana = await member();
    const bia = await member();
    await notify(ana.id, { type: "recado", actorId: bia.id, text: "deixou recado", href: "/u/a" });
    await db
      .prepare("UPDATE notifications SET createdAt = sqlite_now('-10 days') WHERE memberId = ?")
      .run(ana.id);
    expect(await alreadyNotified(ana.id, "recado", bia.id, "/u/a", 7)).toBe(false);
    expect(await alreadyNotified(ana.id, "recado", bia.id, "/u/a", 30)).toBe(true);
    expect(await alreadyNotified(ana.id, "recado", bia.id, "/u/a", null)).toBe(true);
  });

  it("índice do par (memberId, type, actorId, href) existe", async () => {
    const idx = await db
      .prepare("SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_notifications_actor_pair'")
      .get<{ indexdef: string }>();
    expect(idx?.indexdef).toContain('"actorId"');
  });
});
