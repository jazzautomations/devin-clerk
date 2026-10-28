import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createNotice } from "@/lib/communities";
import { digestToken, isoWeekBrt, runDigest } from "@/lib/digest";
import { getPrefs, listNotifications, notify, setPref, unreadCount } from "@/lib/notifications";
import type { Driver, EmailMessage, SendOutcome } from "@/lib/notify/types";
import { resetRateLimits } from "@/lib/ratelimit";
import { isPublicApi } from "@/lib/access";

// Notificações boas (migration 040): preferências por grupo, notify que
// respeita preferência e silêncio, abrir marca o grupo, API das
// preferências, cron do resumo (401, idempotência, driver desligado,
// vazio, 180 dias) e o link assinado de parar de receber.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

// longe do seed: o radar do seed não cai na janela "fecha nesta semana"
const NOW = new Date("2031-03-12T15:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

let seq = 0;
async function member(opts: { lastSeenDaysAgo?: number | null } = {}) {
  const t = `nb${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`);
  const days = opts.lastSeenDaysAgo === undefined ? 1 : opts.lastSeenDaysAgo;
  if (days !== null) {
    await db
      .prepare("UPDATE members SET lastSeenAt = ? WHERE id = ?")
      .run(iso(new Date(NOW.getTime() - days * 86_400_000)), r!.id);
  }
  return { id: r!.id, username: `u_${t}`, clerkId: `clerk_${t}` };
}

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t/api", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function fakeDriver(result: SendOutcome = { status: "sent" }) {
  const sent: EmailMessage[] = [];
  const driver: Driver<EmailMessage> = {
    name: "fake",
    async send(m) {
      sent.push(m);
      return result;
    },
  };
  return { driver, sent };
}

async function sendsOf(memberId: number) {
  return db
    .prepare("SELECT week, status, reason FROM digest_sends WHERE memberId = ? ORDER BY week")
    .all<{ week: string; status: string; reason: string | null }>(memberId);
}

beforeEach(() => {
  clerk.uid = null;
  resetRateLimits();
  vi.unstubAllEnvs();
});

describe("notify respeita preferência e silêncio", () => {
  it("social desligado: reação não notifica, inscrição aprovada notifica", async () => {
    const ana = await member();
    const bia = await member();
    await setPref(ana.id, "social", { inApp: false });
    await notify(ana.id, { type: "reaction", actorId: bia.id, text: "reagiu", href: "/feed" });
    await notify(ana.id, { type: "follow", actorId: bia.id, text: "seguiu", href: "/u/b" });
    await notify(ana.id, { type: "registration_approved", text: "inscrição aprovada", href: "/h/x" });
    expect((await listNotifications(ana.id)).map((n) => n.type)).toEqual(["registration_approved"]);
    // religar volta a gravar
    await setPref(ana.id, "social", { inApp: true });
    await notify(ana.id, { type: "reaction", actorId: bia.id, text: "reagiu", href: "/feed" });
    expect(await unreadCount(ana.id)).toBe(2);
  });

  it("comunidade desligado não mexe no social", async () => {
    const ana = await member();
    const bia = await member();
    await setPref(ana.id, "comunidade", { inApp: false });
    await notify(ana.id, { type: "community_join", actorId: bia.id, text: "entrou" });
    await notify(ana.id, { type: "like", actorId: bia.id, text: "curtiu" });
    expect((await listNotifications(ana.id)).map((n) => n.type)).toEqual(["like"]);
  });

  it("silenciado e bloqueado não geram notificação social; essencial passa", async () => {
    const ana = await member();
    const mudo = await member();
    const bloq = await member();
    await db.prepare("INSERT INTO member_mutes (memberId, mutedId) VALUES (?, ?)").run(ana.id, mudo.id);
    await db.prepare("INSERT INTO member_blocks (memberId, blockedId) VALUES (?, ?)").run(bloq.id, ana.id);
    await notify(ana.id, { type: "comment", actorId: mudo.id, text: "comentou" });
    await notify(ana.id, { type: "like", actorUsername: bloq.username, text: "curtiu" });
    await notify(ana.id, { type: "team_member_left", actorUsername: mudo.username, text: "saiu do time" });
    const rows = await db.prepare("SELECT type FROM notifications WHERE memberId = ?").all<{ type: string }>(ana.id);
    expect(rows.map((r) => r.type)).toEqual(["team_member_left"]);
  });

  it("aviso de comunidade em massa pula quem desligou comunidade", async () => {
    const dono = await member();
    const ana = await member();
    const bia = await member();
    const c = await db
      .prepare("INSERT INTO communities (slug, name) VALUES ('nb-com', 'NB Com') RETURNING id")
      .get<{ id: number }>();
    await db
      .prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono'), (?, ?, 'membro'), (?, ?, 'membro')")
      .run(c!.id, dono.id, c!.id, ana.id, c!.id, bia.id);
    await setPref(bia.id, "comunidade", { inApp: false });
    const res = await createNotice({ id: c!.id, slug: "nb-com", name: "NB Com" }, dono.id, "Encontro sexta", "No lab.");
    expect(res.notified).toBe(1);
    expect(await unreadCount(ana.id)).toBe(1);
    expect(await unreadCount(bia.id)).toBe(0);
  });
});

describe("abrir e marcar lida pega o grupo", () => {
  it("open da cabeça marca as 5 reações; POST {id} também", async () => {
    const ana = await member();
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => member()));
    for (const p of people) await notify(ana.id, { type: "reaction", actorId: p.id, text: "reagiu", href: "/feed#p1" });
    await notify(ana.id, { type: "answer", text: "resposta", href: "/h/x" });
    clerk.uid = ana.clerkId;
    const { GET } = await import("@/app/api/notifications/route");
    const body = await (await GET(new Request("http://t/api/notifications"))).json();
    expect(body.groups).toHaveLength(2);
    expect(body.groups[1].total).toBe(5);
    expect(body.unread).toBe(6);

    const { GET: OPEN } = await import("@/app/api/notifications/[id]/open/route");
    const res = await OPEN(new Request("http://t/x"), { params: Promise.resolve({ id: String(body.groups[1].id) }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://t/feed#p1");
    expect(await unreadCount(ana.id)).toBe(1);

    // de novo pelo POST {id, group} do sino; sem group marca só uma
    for (const p of people) await notify(ana.id, { type: "like", actorId: p.id, text: "curtiu", href: "/feed#p2" });
    const again = await (await GET(new Request("http://t/api/notifications"))).json();
    const likes = again.groups.find((g: { type: string }) => g.type === "like");
    const { POST } = await import("@/app/api/notifications/route");
    expect((await POST(json("POST", { id: likes.id }))).status).toBe(200);
    expect(await unreadCount(ana.id)).toBe(5);
    expect((await POST(json("POST", { id: likes.id, group: true }))).status).toBe(200);
    expect(await unreadCount(ana.id)).toBe(1);
  });

  it("GET com cursor e aba", async () => {
    const ana = await member();
    for (let i = 0; i < 12; i++) await notify(ana.id, { type: `t${i}`, text: `n${i}` });
    clerk.uid = ana.clerkId;
    const { GET } = await import("@/app/api/notifications/route");
    const first = await (await GET(new Request("http://t/api/notifications"))).json();
    expect(first.groups).toHaveLength(8);
    expect(first.next).toBe(first.groups[7].id);
    const rest = await (await GET(new Request(`http://t/api/notifications?antes=${first.next}&limite=30`))).json();
    expect(rest.groups).toHaveLength(4);
    expect(rest.next).toBeNull();
    expect(rest.notifications).toEqual([]);
    const men = await (await GET(new Request("http://t/api/notifications?aba=mencoes"))).json();
    expect(men.groups).toEqual([]);
  });
});

describe("/api/notifications/preferencias", () => {
  it("401 deslogado", async () => {
    const { GET, PATCH } = await import("@/app/api/notifications/preferencias/route");
    expect((await GET()).status).toBe(401);
    expect((await PATCH(json("PATCH", { group: "social", inApp: false }))).status).toBe(401);
  });

  it("padrão, PATCH por grupo e validação", async () => {
    const ana = await member();
    clerk.uid = ana.clerkId;
    const { GET, PATCH } = await import("@/app/api/notifications/preferencias/route");
    expect((await (await GET()).json()).prefs).toEqual({
      social: { inApp: true, email: false },
      comunidade: { inApp: true, email: false },
      digest: { inApp: false, email: true },
    });
    const r1 = await PATCH(json("PATCH", { group: "social", inApp: false }));
    expect(r1.status).toBe(200);
    expect((await r1.json()).prefs.social.inApp).toBe(false);
    const r2 = await PATCH(json("PATCH", { group: "digest", email: false }));
    expect((await r2.json()).prefs.digest.email).toBe(false);
    expect((await getPrefs(ana.id)).comunidade.inApp).toBe(true);

    expect((await PATCH(json("PATCH", { group: "essencial", inApp: false }))).status).toBe(400);
    expect((await PATCH(json("PATCH", { group: "social", inApp: "nao" }))).status).toBe(400);
    expect((await PATCH(json("PATCH", { group: "digest", inApp: false }))).status).toBe(400);
  });

  it("rate limit: 60 por hora", async () => {
    const ana = await member();
    clerk.uid = ana.clerkId;
    const { PATCH } = await import("@/app/api/notifications/preferencias/route");
    for (let i = 0; i < 60; i++) {
      expect((await PATCH(json("PATCH", { group: "social", inApp: i % 2 === 0 }))).status).toBe(200);
    }
    const r = await PATCH(json("PATCH", { group: "social", inApp: true }));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("runDigest", () => {
  it("vazio não envia; com conteúdo envia uma vez por semana", async () => {
    const vazio = await member();
    const cheio = await member();
    await notify(cheio.id, { type: "answer", text: "resposta" });
    const { driver, sent } = fakeDriver();
    const r1 = await runDigest(NOW, driver);
    expect(r1.week).toBe(isoWeekBrt(NOW));
    expect(sent.filter((m) => m.to === `${cheio.username.slice(2)}@t.dev`)).toHaveLength(1);
    expect(sent.some((m) => m.to === `${vazio.username.slice(2)}@t.dev`)).toBe(false);
    expect(await sendsOf(vazio.id)).toEqual([{ week: r1.week, status: "vazio", reason: null }]);
    expect((await sendsOf(cheio.id))[0].status).toBe("enviado");
    const msg = sent.find((m) => m.to.startsWith(cheio.username.slice(2)))!;
    expect(msg.idempotencyKey).toBe(`digest:${cheio.id}:${r1.week}`);
    expect(msg.unsubscribeUrl).toContain(`/api/notifications/digest/sair/${digestToken(cheio.id)}`);
    expect(msg.text).toContain("Você tem 1 notificação não lida");

    // segunda execução na mesma semana: ninguém recebe de novo
    const again = fakeDriver();
    await runDigest(NOW, again.driver);
    expect(again.sent.filter((m) => m.to.startsWith(cheio.username.slice(2)))).toHaveLength(0);
    expect((await sendsOf(cheio.id))).toHaveLength(1);
  });

  it("falhou: a próxima execução tenta de novo", async () => {
    const ana = await member();
    await notify(ana.id, { type: "answer", text: "resposta" });
    const bad = fakeDriver({ status: "failed", error: "HTTP 500" });
    await runDigest(NOW, bad.driver);
    expect((await sendsOf(ana.id))[0]).toMatchObject({ status: "falhou", reason: "HTTP 500" });
    await db.prepare("UPDATE digest_sends SET createdAt = sqlite_now('-10 minutes') WHERE memberId = ?").run(ana.id);
    const ok = fakeDriver();
    await runDigest(NOW, ok.driver);
    expect((await sendsOf(ana.id))[0].status).toBe("enviado");
  });

  it("sem lastSeenAt nos últimos 180 dias não recebe; resumo desligado também não", async () => {
    const sumido = await member({ lastSeenDaysAgo: 181 });
    const nunca = await member({ lastSeenDaysAgo: null });
    const desligou = await member();
    const recente = await member({ lastSeenDaysAgo: 179 });
    for (const m of [sumido, nunca, desligou, recente]) await notify(m.id, { type: "answer", text: "r" });
    await setPref(desligou.id, "digest", { email: false });
    const { driver } = fakeDriver();
    await runDigest(NOW, driver);
    expect(await sendsOf(sumido.id)).toEqual([]);
    expect(await sendsOf(nunca.id)).toEqual([]);
    expect(await sendsOf(desligou.id)).toEqual([]);
    expect((await sendsOf(recente.id))[0].status).toBe("enviado");
  });

  it("bounce vira pulado sem chamar o driver", async () => {
    const ana = await member();
    await db.prepare("UPDATE members SET emailBouncedAt = sqlite_now() WHERE id = ?").run(ana.id);
    await notify(ana.id, { type: "answer", text: "r" });
    const { driver, sent } = fakeDriver();
    await runDigest(NOW, driver);
    expect((await sendsOf(ana.id))[0].status).toBe("pulado");
    expect(sent.some((m) => m.idempotencyKey === `digest:${ana.id}:${isoWeekBrt(NOW)}`)).toBe(false);
  });
});

describe("POST /api/cron/digest", () => {
  it("401 sem bearer ou com bearer errado", async () => {
    const { POST } = await import("@/app/api/cron/digest/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "segredo-cron");
    expect((await POST(json("POST"))).status).toBe(401);
    expect((await POST(json("POST", undefined, { Authorization: "Bearer chute" }))).status).toBe(401);
  });

  it("sem RESEND_API_KEY grava 'pulado' e responde 200; idempotente", async () => {
    const { POST } = await import("@/app/api/cron/digest/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "segredo-cron");
    vi.stubEnv("RESEND_API_KEY", "");
    const ana = await member();
    await notify(ana.id, { type: "answer", text: "r" });
    const res = await POST(json("POST", undefined, { Authorization: "Bearer segredo-cron" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pulado).toBeGreaterThanOrEqual(1);
    const rows = await sendsOf(ana.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pulado");
    expect(rows[0].reason).toContain("RESEND_API_KEY");
    await POST(json("POST", undefined, { Authorization: "Bearer segredo-cron" }));
    expect(await sendsOf(ana.id)).toHaveLength(1);
  });
});

describe("parar de receber pelo link", () => {
  it("rota é pública; token inválido dá 404; GET confirma, POST desliga", async () => {
    expect(isPublicApi(`/api/notifications/digest/sair/${digestToken(1)}`)).toBe(true);
    const ana = await member();
    const route = await import("@/app/api/notifications/digest/sair/[token]/route");
    const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

    expect((await route.GET(new Request("http://t"), ctx("lixo"))).status).toBe(404);
    expect((await route.POST(new Request("http://t", { method: "POST" }), ctx("lixo"))).status).toBe(404);
    const forged = digestToken(ana.id).replace(`D1.${ana.id}.`, `D1.${ana.id + 1}.`);
    expect((await route.POST(new Request("http://t", { method: "POST" }), ctx(forged))).status).toBe(404);

    const token = digestToken(ana.id);
    const get = await route.GET(new Request("http://t"), ctx(token));
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('method="post"');
    // GET não desliga (leitor de e-mail abre links sozinho)
    expect((await getPrefs(ana.id)).digest.email).toBe(true);

    const post = await route.POST(new Request("http://t", { method: "POST" }), ctx(token));
    expect(post.status).toBe(200);
    expect(await post.text()).toContain("o resumo parou");
    expect((await getPrefs(ana.id)).digest.email).toBe(false);
    // o resto continua como estava
    expect((await getPrefs(ana.id)).social.inApp).toBe(true);
  });

  it("conta excluída: 404", async () => {
    const ana = await member();
    await db.prepare("UPDATE members SET clerkId = ? WHERE id = ?").run(`deleted:${ana.id}`, ana.id);
    const route = await import("@/app/api/notifications/digest/sair/[token]/route");
    const res = await route.POST(new Request("http://t", { method: "POST" }), { params: Promise.resolve({ token: digestToken(ana.id) }) });
    expect(res.status).toBe(404);
  });
});
