import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { announceEditionLaunch } from "@/lib/editionLaunch";

// Hackathon de uma comunidade que entra no ar pela primeira vez avisa os
// membros DELA (notificação + fila de e-mail como aviso do sistema), e só uma
// vez. Quem é de outra comunidade ou só tem conta não recebe.

let n = 0;
async function member() {
  n++;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_launch_${n}`, `launch${n}`, `launch${n}@exemplo.com`);
  return r!.id;
}
async function community(slug: string, members: number[], hidden = 0) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, hidden) VALUES (?, ?, 'Sorocaba, SP', ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, hidden);
  for (const m of members) {
    await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(c!.id, m);
  }
  return c!.id;
}
async function edition(id: string, communityId: number | null, active: number) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, communityId)
       VALUES (?, ?, 'Org', '2026-12-05T09:00:00-03:00', 'presencial', '', '[]', ?, 'painel', ?)`,
    )
    .run(id, `Edição ${id}`, active, communityId);
}
const notesFor = async (id: string) =>
  (
    await db
      .prepare("SELECT memberId FROM notifications WHERE type = 'edicao_nova' AND href = ? ORDER BY memberId")
      .all<{ memberId: number }>(`/h/${id}`)
  ).map((r) => r.memberId);

describe("anúncio de hackathon novo pra comunidade", () => {
  it("avisa só os membros da comunidade, com e-mail na fila como aviso do sistema, uma vez só", async () => {
    const a1 = await member();
    const a2 = await member();
    const outro = await member();
    await member(); // só tem conta
    const ca = await community("launch-a", [a1, a2]);
    await community("launch-b", [outro]);
    await edition("launch-a-1", ca, 1);

    const r = await announceEditionLaunch("launch-a-1");
    expect(r).toEqual({ notified: 2, queued: expect.any(Number) });
    expect(r!.queued).toBeGreaterThan(0);
    expect(await notesFor("launch-a-1")).toEqual([a1, a2]);
    const ann = await db
      .prepare("SELECT system FROM announcements WHERE hackathonId = ?")
      .all<{ system: number }>("launch-a-1");
    expect(ann).toEqual([{ system: 1 }]);
    const deliveries = await db
      .prepare(
        `SELECT DISTINCT d.memberId FROM deliveries d JOIN announcements a ON a.id = d.announcementId
         WHERE a.hackathonId = ? ORDER BY d.memberId`,
      )
      .all<{ memberId: number }>("launch-a-1");
    expect(deliveries.map((d) => d.memberId)).toEqual([a1, a2]);

    // publicar de novo (despublicou e voltou) não anuncia outra vez
    expect(await announceEditionLaunch("launch-a-1")).toBeNull();
    expect(await notesFor("launch-a-1")).toEqual([a1, a2]);
  });

  it("rascunho, edição sem comunidade e comunidade escondida não anunciam", async () => {
    const m = await member();
    const c = await community("launch-c", [m]);
    const hid = await community("launch-h", [m], 1);
    await edition("launch-draft", c, 0);
    await edition("launch-solta", null, 1);
    await edition("launch-escondida", hid, 1);
    for (const id of ["launch-draft", "launch-solta", "launch-escondida"]) {
      expect(await announceEditionLaunch(id), id).toBeNull();
      expect(await notesFor(id), id).toEqual([]);
    }
  });
});
