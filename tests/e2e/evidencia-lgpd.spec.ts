import { expect } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";
import { notify } from "@/lib/notifications";
import { deleteMemberData } from "@/lib/privacy";

// Base de confiança (spec 046, evidencia-e-lgpd) no servidor buildado:
// navegar logado grava members.lastSeenAt no máximo 1x por hora, e o export
// LGPD traz o campo novo sem trazer notificação que a pessoa causou na
// caixa de outra.

const OUTRA = "clerk_e2e_evidencia_outra";
const SAIU = "clerk_e2e_evidencia_saiu";
let saiuId: number | null = null;

async function e2eMember() {
  const db = openE2eDb();
  return (await db
    .prepare("SELECT id, username FROM members WHERE email = ?")
    .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL))!;
}

const lastSeen = async (id: number) =>
  (await openE2eDb().prepare("SELECT lastSeenAt FROM members WHERE id = ?").get<{ lastSeenAt: string | null }>(id))!
    .lastSeenAt;

test.afterAll(async () => {
  const db = openE2eDb();
  if (saiuId) {
    await db.prepare("DELETE FROM notifications WHERE actorId = ?").run(saiuId);
    await db.prepare("DELETE FROM members WHERE id = ?").run(saiuId);
  }
  const o = await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(OUTRA);
  if (o) {
    await db.prepare("DELETE FROM notifications WHERE memberId = ?").run(o.id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(o.id);
  }
});

test("navegar logado grava lastSeenAt, no máximo 1 vez por hora", async ({ memberPage }) => {
  await memberPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const me = await e2eMember();
  const db = openE2eDb();

  await db.prepare("UPDATE members SET lastSeenAt = sqlite_now('-2 hours') WHERE id = ?").run(me.id);
  const old = await lastSeen(me.id);
  await memberPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect.poll(() => lastSeen(me.id)).not.toBe(old);

  // páginas que carregam o membro por currentMember (/notificacoes) também gravam
  await db.prepare("UPDATE members SET lastSeenAt = sqlite_now('-3 hours') WHERE id = ?").run(me.id);
  const older = await lastSeen(me.id);
  await memberPage.goto("/notificacoes", { waitUntil: "domcontentloaded" });
  await expect.poll(() => lastSeen(me.id)).not.toBe(older);

  await db.prepare("UPDATE members SET lastSeenAt = sqlite_now('-10 minutes') WHERE id = ?").run(me.id);
  const recent = await lastSeen(me.id);
  await memberPage.goto("/notificacoes", { waitUntil: "domcontentloaded" });
  await memberPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  expect(await lastSeen(me.id)).toBe(recent);
});

test("export LGPD traz lastSeenAt e deixa de fora a notificação que eu causei", async ({ memberPage }) => {
  const me = await e2eMember();
  const db = openE2eDb();
  const outra = await db
    .prepare(
      `INSERT INTO members (clerkId, username, email) VALUES (?, 'e2e_evidencia_outra', 'e2e-evidencia-outra@t.dev')
       ON CONFLICT (clerkId) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    )
    .get<{ id: number }>(OUTRA);
  await db
    .prepare(
      `INSERT INTO notifications (memberId, actorUsername, actorId, type, text, href)
       VALUES (?, ?, ?, 'follow', 'seguiu você', '/u/e2e')`,
    )
    .run(outra!.id, me.username, me.id);

  const req = await memberRequest(memberPage);
  const res = await req.get("/api/members/me/export");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.member.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(Object.keys(body.data)).not.toContain("notifications.actorId");
});

test("quem excluiu a conta some do texto da minha notificação", async ({ memberPage }) => {
  const me = await e2eMember();
  const db = openE2eDb();
  const saiu = (await db
    .prepare(
      `INSERT INTO members (clerkId, username, email) VALUES (?, 'e2e_evid_saiu', 'e2e-evidencia-saiu@t.dev')
       ON CONFLICT (clerkId) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    )
    .get<{ id: number }>(SAIU))!;
  saiuId = saiu.id;
  await notify(me.id, { type: "like", actorUsername: "e2e_evid_saiu", text: "@e2e_evid_saiu curtiu seu post", href: "/feed" });
  await deleteMemberData(saiu.id);

  await memberPage.setViewportSize({ width: 390, height: 844 });
  await memberPage.goto("/notificacoes", { waitUntil: "domcontentloaded" });
  await expect(memberPage.getByText(`@removido-${saiu.id} curtiu seu post`).first()).toBeVisible();
  await expect(memberPage.getByText("@e2e_evid_saiu")).toHaveCount(0);
  const overflow = await memberPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
