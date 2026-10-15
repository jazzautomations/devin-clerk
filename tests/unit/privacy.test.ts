import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { getOrCreateMember } from "@/lib/members";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { grantEditionRole } from "@/lib/roles";

const H = "hack-inova-alphaville-2026";
const H_PAST = "hack-inova-unifacens-2026"; // edição encerrada: inscrição fica anonimizada

async function setup(tag: string) {
  const m = await getOrCreateMember({ id: `c_priv_${tag}`, firstName: "Ana", lastName: "Dados", email: `${tag}@priv.dev` });
  const other = await getOrCreateMember({ id: `c_priv_o_${tag}`, firstName: null, lastName: null, email: `o_${tag}@priv.dev` });
  await db.prepare("UPDATE members SET phone = '5511999999999', linkedin = 'ana' WHERE id = ?").run(m.id);
  await db.prepare("INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?)").run(m.id, H_PAST);
  const post = await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'meu post') RETURNING id").get<{ id: number }>(m.id);
  await db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(post!.id, other.id);
  await db.prepare("INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, 'oi')").run(post!.id, other.id);
  await db.prepare("INSERT INTO notifications (memberId, type, text) VALUES (?, 'x', 'y')").run(m.id);
  await grantEditionRole(H, m.id, "mentor", other.id);
  const team = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id").get<{ id: number }>(H, `T ${tag}`);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(team!.id, m.username);
  return { m, other, teamId: team!.id };
}

describe("direitos do titular (LGPD)", () => {
  it("exporta tudo que referencia o membro, inclusive time por username", async () => {
    const { m } = await setup("exp");
    const out = await exportMemberData(m.id);
    expect(out?.member).toMatchObject({ id: m.id, linkedin: "ana" });
    expect(Object.keys(out!.data)).toEqual(
      expect.arrayContaining(["registrations.memberId", "posts.memberId", "notifications.memberId", "edition_roles.memberId", "team_members.username"]),
    );
  });

  it("exclusão apaga conteúdo pessoal, anonimiza o membro e mantém a contagem de edição encerrada", async () => {
    const { m, teamId } = await setup("del");
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE hackathonId = ?").get<{ n: number }>(H_PAST))!.n;
    const clerkId = await deleteMemberData(m.id);
    expect(clerkId).toBe("c_priv_del");
    const row = await db.prepare("SELECT * FROM members WHERE id = ?").get<Record<string, unknown>>(m.id);
    expect(row).toMatchObject({ name: null, phone: null, linkedin: null, username: `removido-${m.id}` });
    expect(String(row!.email)).toMatch(/removido\.invalid$/);
    expect(await db.prepare("SELECT 1 FROM posts WHERE memberId = ?").get(m.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM notifications WHERE memberId = ?").get(m.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM edition_roles WHERE memberId = ?").get(m.id)).toBeUndefined();
    const after = (await db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE hackathonId = ?").get<{ n: number }>(H_PAST))!.n;
    expect(after).toBe(before);
    const tm = await db.prepare("SELECT username FROM team_members WHERE teamId = ?").all<{ username: string }>(teamId);
    expect(tm.map((t) => t.username)).toEqual([`removido-${m.id}`]);
    // segunda chamada não faz nada
    expect(await deleteMemberData(m.id)).toBeNull();
  });
});

describe("exclusão × fila de espera (achado do QA)", () => {
  it("conta excluída sai da fila e o aprovado de edição futura libera a vaga", async () => {
    const H2 = "privacidade-fila";
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, capacity, source)
         VALUES (?, 'Fila LGPD', 'Hack Inova', '2099-05-01', 'presencial', 'https://x.dev', 1, 'painel')
         ON CONFLICT (id) DO NOTHING`,
      )
      .run(H2);
    const a = await getOrCreateMember({ id: "c_fila_a", firstName: null, lastName: null, email: "fa@priv.dev" });
    const b = await getOrCreateMember({ id: "c_fila_b", firstName: null, lastName: null, email: "fb@priv.dev" });
    const c = await getOrCreateMember({ id: "c_fila_c", firstName: null, lastName: null, email: "fc@priv.dev" });
    await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(a.id, H2);
    await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'waitlist')").run(b.id, H2);
    await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'waitlist')").run(c.id, H2);
    // b (na fila) exclui a conta → some da fila
    await deleteMemberData(b.id);
    expect(await db.prepare("SELECT 1 FROM registrations WHERE memberId = ? AND hackathonId = ?").get(b.id, H2)).toBeUndefined();
    // a (aprovada, edição futura) exclui → vaga vai pra c
    await deleteMemberData(a.id);
    expect(await db.prepare("SELECT 1 FROM registrations WHERE memberId = ? AND hackathonId = ?").get(a.id, H2)).toBeUndefined();
    const st = await db.prepare("SELECT status FROM registrations WHERE memberId = ? AND hackathonId = ?").get<{ status: string }>(c.id, H2);
    expect(st?.status).toBe("approved");
  });
});
