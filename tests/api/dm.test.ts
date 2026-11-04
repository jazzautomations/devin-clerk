import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { canMessage, DM_REQUEST_MAX, threadBetween, unreadDmCount } from "@/lib/dm";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import { getReport } from "@/lib/reports";

// Mensagem direta com trava (migration 056): laço abre direto, sem laço vira
// pedido de 280, aceite abre e recusa segura 30 dias; bloqueio é 404 e some
// o botão; thread alheia é 404; denúncia vai pra fila com o snapshot da
// mensagem (e incidente quando os dois estão na edição rolando); exclusão
// LGPD apaga a conversa dos dois lados.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(): Promise<M> {
  const tag = `dm${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const json = (method: string, body?: unknown) =>
  new Request("http://t", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const routes = async () => ({
  root: await import("@/app/api/dm/route"),
  one: await import("@/app/api/dm/[id]/route"),
  msgs: await import("@/app/api/dm/[id]/messages/route"),
  accept: await import("@/app/api/dm/[id]/accept/route"),
  decline: await import("@/app/api/dm/[id]/decline/route"),
  report: await import("@/app/api/dm/messages/[id]/report/route"),
});
const post = (username: string, body: string) => json("POST", { username, body });

const follow = async (a: M, b: M, both = true) => {
  await db.prepare("INSERT OR IGNORE INTO member_follows (memberId, followedId) VALUES (?, ?)").run(a.id, b.id);
  if (both) await db.prepare("INSERT OR IGNORE INTO member_follows (memberId, followedId) VALUES (?, ?)").run(b.id, a.id);
};
async function team(hackathonId: string, people: M[]) {
  const t = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id").get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const p of people) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, p.username);
  return t!.id;
}
async function edition(id: string, live: boolean) {
  const day = 86_400_000;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel')`,
    )
    .run(id, `Edição ${id}`, new Date(Date.now() + (live ? -day : 30 * day)).toISOString(), new Date(Date.now() + (live ? day : 31 * day)).toISOString());
}
const approved = async (m: M, h: string) =>
  db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(m.id, h);
const encounter = async (a: M, b: M, status = "confirmed") => {
  const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  await db
    .prepare(`INSERT INTO encounters ("hackathonId", "lowId", "highId", "initiatorId", status) VALUES ('dm-enc', ?, ?, ?, ?)`)
    .run(low, high, a.id, status);
};
const vagaAceita = async (candidato: M, colega: M) => {
  const t = await team("dm-vaga", [colega]);
  const o = await db
    .prepare(`INSERT INTO team_openings ("teamId", "hackathonId", area, intro) VALUES (?, 'dm-vaga', 'dev', 'procuro dev') RETURNING id`)
    .get<{ id: number }>(t);
  await db
    .prepare(`INSERT INTO opening_applications ("openingId", "memberId", intro, status) VALUES (?, ?, 'bora', 'aceita')`)
    .run(o!.id, candidato.id);
};
const notifs = async (m: M) =>
  db.prepare("SELECT type, text, href, actorId FROM notifications WHERE memberId = ? ORDER BY id").all<{ type: string; text: string; href: string | null; actorId: number | null }>(m.id);
const threadIdOf = async (a: M, b: M) => (await threadBetween(a.id, b.id))?.id;

beforeEach(() => {
  resetRateLimits();
});

describe("canMessage: a trava", () => {
  it("sem laço é pedido; bloqueio e conta excluída são 'bloqueado'", async () => {
    const a = await member();
    const b = await member();
    expect(await canMessage(a.id, b.id)).toEqual({ estado: "pedido", motivo: expect.stringContaining("pedido") });
    await block(b.id, a.id);
    expect((await canMessage(a.id, b.id)).estado).toBe("bloqueado");
    const c = await member();
    const d = await member();
    await deleteMemberData(d.id);
    expect((await canMessage(c.id, d.id)).estado).toBe("bloqueado");
  });

  it("livre: seguir mútuo, mesmo time, encontro confirmado e vaga aceita", async () => {
    await edition("dm-enc", true);
    await edition("dm-vaga", false);
    const a = await member();
    const b = await member();
    await follow(a, b);
    expect((await canMessage(a.id, b.id)).motivo).toBe("vocês se seguem");
    const c = await member();
    const d = await member();
    await follow(c, d, false); // seguir de um lado só não basta
    expect((await canMessage(c.id, d.id)).estado).toBe("pedido");
    await team("dm-enc", [c, d]);
    expect((await canMessage(c.id, d.id)).motivo).toContain("fizeram time");
    const e = await member();
    const f = await member();
    await encounter(e, f);
    expect((await canMessage(e.id, f.id)).motivo).toContain("encontraram");
    const g = await member();
    const h = await member();
    await vagaAceita(g, h);
    expect((await canMessage(g.id, h.id)).motivo).toContain("vaga aceita");
    expect((await canMessage(h.id, g.id)).estado).toBe("livre"); // vale pros dois lados
    // encontro pendente ou recusado não abre
    const i = await member();
    const j = await member();
    await encounter(i, j, "pending");
    expect((await canMessage(i.id, j.id)).estado).toBe("pedido");
  });
});

describe("POST /api/dm", () => {
  it("401 deslogado; 404 pra quem não existe e pra bloqueio", async () => {
    const { root } = await routes();
    const a = await member();
    const b = await member();
    expect((await root.POST(post(b.username, "oi"))).status).toBe(401);
    as(a);
    expect((await root.POST(post("ninguem_aqui", "oi"))).status).toBe(404);
    await block(b.id, a.id);
    const r = await root.POST(post(b.username, "oi"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(await (await root.POST(post("ninguem_aqui", "oi"))).json());
    expect(await threadIdOf(a, b)).toBeUndefined();
  });

  it("com laço abre direto e a mensagem chega; sem laço vira pedido de 280", async () => {
    const { root, one } = await routes();
    const a = await member();
    const b = await member();
    await follow(a, b);
    as(a);
    const r = await root.POST(post(b.username, "bora fechar a demo?"));
    expect(r.status).toBe(201);
    const { threadId, status } = await r.json();
    expect(status).toBe("aberta");
    // o outro lado lê a conversa
    as(b);
    const view = await one.GET(new Request(`http://t/api/dm/${threadId}`), idCtx(threadId));
    expect(view.status).toBe(200);
    const v = await view.json();
    expect(v.falar).toBe(true);
    expect(v.messages.map((m: { body: string }) => m.body)).toEqual(["bora fechar a demo?"]);
    // sem laço: 281 caracteres não passa
    const c = await member();
    const d = await member();
    as(c);
    expect((await root.POST(post(d.username, "x".repeat(DM_REQUEST_MAX + 1)))).status).toBe(400);
    const r2 = await root.POST(post(d.username, "fizemos o mesmo desafio na faculdade, bora?"));
    expect(r2.status).toBe(201);
    expect((await r2.json()).status).toBe("pedido");
    const t2 = (await threadIdOf(c, d))!;
    const thread = await threadBetween(c.id, d.id);
    expect(thread).toMatchObject({ status: "pedido", requestedBy: c.id });
    expect((await notifs(d)).map((n) => n.type)).toContain("dm");
    // pedido pendente não repete
    expect((await root.POST(post(d.username, "e aí?"))).status).toBe(409);
    // quem recebeu o pedido vê a caixa com o pedido
    as(d);
    const inbox = await (await routes()).root.GET(new Request("http://t/api/dm"));
    const box = await inbox.json();
    expect(box.pedidos.map((p: { id: number }) => p.id)).toEqual([t2]);
    expect(box.unread).toBe(1);
  });

  it("pedido aceito abre; recusado segura 30 dias e quem pediu não é avisado", async () => {
    const { root, accept, decline, msgs } = await routes();
    const a = await member();
    const b = await member();
    const c = await member();
    as(a);
    const pa = await (await root.POST(post(b.username, "aceita?"))).json();
    const pr = await (await root.POST(post(c.username, "aceita?"))).json();
    // recusa: silenciosa, pedido novo dentro de 30 dias dá 400
    as(c);
    expect((await decline.POST(json("POST"), idCtx(pr.threadId))).status).toBe(200);
    as(a);
    const again = await root.POST(post(c.username, "de novo?"));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "Espere um tempo antes de pedir de novo." });
    expect((await threadBetween(a.id, c.id))!.status).toBe("recusada");
    // aceite: a conversa abre pros dois e quem pediu é avisado
    as(b);
    expect((await accept.POST(json("POST"), idCtx(pa.threadId))).status).toBe(200);
    expect((await threadBetween(a.id, b.id))!.status).toBe("aberta");
    const r = await msgs.POST(json("POST", { body: "fechei!" }), idCtx(pa.threadId));
    expect(r.status).toBe(201);
    const ns = await notifs(a);
    expect(ns.at(-1)).toMatchObject({ type: "dm", text: `@${b.username} aceitou conversar com você`, actorId: b.id });
    // quem pediu não pode aceitar nem recusar o próprio pedido
    const d = await member();
    as(a);
    const p3 = await (await root.POST(post(d.username, "aceita?"))).json();
    expect((await accept.POST(json("POST"), idCtx(p3.threadId))).status).toBe(400);
    expect((await decline.POST(json("POST"), idCtx(p3.threadId))).status).toBe(400);
    // aceitar/recusar thread alheia: 404
    const e = await member();
    as(e);
    expect((await accept.POST(json("POST"), idCtx(pa.threadId))).status).toBe(404);
  });

  it("laço que chega depois abre o pedido pendente; 5 pedidos por dia dá 429", async () => {
    const { root, msgs } = await routes();
    const a = await member();
    const b = await member();
    as(a);
    const p = await (await root.POST(post(b.username, "pedido antes do laço"))).json();
    await follow(a, b);
    const r = await root.POST(post(b.username, "agora nos seguimos"));
    expect(r.status).toBe(201);
    expect((await r.json()).status).toBe("aberta");
    expect((await threadBetween(a.id, b.id))!.id).toBe(p.threadId);
    // 5 pedidos no dia: o 6º dá 429
    for (let i = 0; i < 4; i++) {
      const x = await member();
      expect((await root.POST(post(x.username, "pedido"))).status).toBe(201);
    }
    const sexto = await member();
    const r429 = await root.POST(post(sexto.username, "pedido"));
    expect(r429.status).toBe(429);
    expect(Number(r429.headers.get("Retry-After"))).toBeGreaterThan(0);
    // mensagem em conversa aberta usa o outro balde: segue livre
    expect((await msgs.POST(json("POST", { body: "ok" }), idCtx(p.threadId))).status).toBe(201);
  });
});

describe("GET /api/dm/[id] e mensagens", () => {
  it("thread alheia dá 404 em tudo; abrir marca como lida", async () => {
    const { root, one, msgs } = await routes();
    const a = await member();
    const b = await member();
    const x = await member();
    await follow(a, b);
    as(a);
    const { threadId } = await (await root.POST(post(b.username, "oi"))).json();
    as(x);
    expect((await one.GET(new Request(`http://t/api/dm/${threadId}`), idCtx(threadId))).status).toBe(404);
    expect((await msgs.POST(json("POST", { body: "espião" }), idCtx(threadId))).status).toBe(404);
    expect(await unreadDmCount(b.id)).toBe(1);
    as(b);
    const v = await (await one.GET(new Request(`http://t/api/dm/${threadId}`), idCtx(threadId))).json();
    expect(v.thread.peer.username).toBe(a.username);
    expect(await unreadDmCount(b.id)).toBe(0);
    // pedido: quem pediu não escreve mais até o aceite
    const c = await member();
    const d = await member();
    as(c);
    const { threadId: t2 } = await (await root.POST(post(d.username, "pedido"))).json();
    const deny = await msgs.POST(json("POST", { body: "insistindo" }), idCtx(t2));
    expect(deny.status).toBe(400);
  });

  it("notificação só no primeiro aviso da thread não lida", async () => {
    const { root, one, msgs } = await routes();
    const a = await member();
    const b = await member();
    await follow(a, b);
    as(a);
    const { threadId } = await (await root.POST(post(b.username, "m1"))).json();
    await msgs.POST(json("POST", { body: "m2" }), idCtx(threadId));
    await msgs.POST(json("POST", { body: "m3" }), idCtx(threadId));
    const ns = (await notifs(b)).filter((n) => n.type === "dm" && n.actorId === a.id);
    expect(ns).toHaveLength(1); // 3 mensagens, 1 aviso
    as(b);
    await one.GET(new Request(`http://t/api/dm/${threadId}`), idCtx(threadId)); // leu
    as(a);
    await msgs.POST(json("POST", { body: "m4" }), idCtx(threadId));
    expect((await notifs(b)).filter((n) => n.type === "dm" && n.actorId === a.id)).toHaveLength(2);
  });

  it("bloqueio fecha o campo de escrever (404 na API, falar=false)", async () => {
    const { root, one, msgs } = await routes();
    const a = await member();
    const b = await member();
    await follow(a, b);
    as(a);
    const { threadId } = await (await root.POST(post(b.username, "oi"))).json();
    await block(b.id, a.id);
    const r = await msgs.POST(json("POST", { body: "ainda aí?" }), idCtx(threadId));
    expect(r.status).toBe(404);
    const v = await (await one.GET(new Request(`http://t/api/dm/${threadId}`), idCtx(threadId))).json();
    expect(v.falar).toBe(false);
    // dmEntryPoint esconde o botão no /u
    const { dmEntryPoint } = await import("@/lib/dm");
    expect(await dmEntryPoint(a.id, b)).toBeNull();
  });

  it("paginação por 'antes' traz as antigas em ordem", async () => {
    const { root, one, msgs } = await routes();
    const a = await member();
    const b = await member();
    await follow(a, b);
    as(a);
    const { threadId } = await (await root.POST(post(b.username, "m0"))).json();
    for (let i = 1; i <= 55; i++) await msgs.POST(json("POST", { body: `m${i}` }), idCtx(threadId));
    const page1 = await (await one.GET(new Request(`http://t/api/dm/${threadId}`), idCtx(threadId))).json();
    expect(page1.messages).toHaveLength(50);
    expect(page1.messages[0].body).toBe("m6");
    expect(page1.mais).toBeTruthy();
    const page2 = await (await one.GET(new Request(`http://t/api/dm/${threadId}?antes=${page1.mais}`), idCtx(threadId))).json();
    expect(page2.messages.map((m: { body: string }) => m.body)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    expect(page2.mais).toBeNull();
  });
});

describe("denúncia de DM", () => {
  it("vai pra fila com o snapshot da mensagem e bloqueia; alheia dá 404", async () => {
    const { root, msgs, report } = await routes();
    const a = await member();
    const b = await member();
    const x = await member();
    await follow(a, b);
    as(a);
    const { threadId } = await (await root.POST(post(b.username, "primeira tranquila"))).json();
    const m2 = await (await msgs.POST(json("POST", { body: "ofensa aqui" }), idCtx(threadId))).json();
    // quem não está na conversa não denuncia
    as(x);
    expect((await report.POST(json("POST", { reason: "ofensa ou assédio" }), idCtx(m2.message.id))).status).toBe(404);
    // quem está denuncia: a fila recebe o snapshot, e só ele
    as(b);
    const r = await report.POST(json("POST", { reason: "ofensa ou assédio" }), idCtx(m2.message.id));
    expect(r.status).toBe(201);
    const { id } = await r.json();
    const rep = (await getReport(id))!;
    expect(rep.targetType).toBe("dm");
    expect(rep.targetMemberId).toBe(a.id);
    expect(rep.routedTo).toBe("admin");
    expect(rep.snapshot).toContain("ofensa aqui");
    expect(rep.snapshot).not.toContain("primeira tranquila"); // só a denunciada
    expect(rep.href).toBeNull(); // DM não tem página pública
    // denunciar bloqueou: a conversa fecha
    expect((await msgs.POST(json("POST", { body: "oi?" }), idCtx(threadId))).status).toBe(404);
  });

  it("com os dois na edição rolando vira incidente; edição encerrada fica no admin", async () => {
    const { root, msgs, report } = await routes();
    await edition("dm-rolando", true);
    await edition("dm-passada", false);
    const a = await member();
    const b = await member();
    await follow(a, b);
    await approved(a, "dm-rolando");
    await approved(b, "dm-rolando");
    await approved(a, "dm-passada");
    await approved(b, "dm-passada");
    as(a);
    const { threadId } = await (await root.POST(post(b.username, "oi"))).json();
    const m = await (await msgs.POST(json("POST", { body: "assédio no evento" }), idCtx(threadId))).json();
    as(b);
    const r = await report.POST(json("POST", { reason: "ofensa ou assédio" }), idCtx(m.message.id));
    const { id, incidentId } = await r.json();
    expect(incidentId).not.toBeNull();
    const rep = (await getReport(id))!;
    expect(rep.hackathonId).toBe("dm-rolando");
    expect(rep.routedTo).toBe("edição Edição dm-rolando");
    // sem edição rolando em comum, o admin fica com ela
    const c = await member();
    const d = await member();
    await follow(c, d);
    as(c);
    const { threadId: t2 } = await (await root.POST(post(d.username, "oi"))).json();
    const m2 = await (await msgs.POST(json("POST", { body: "spam" }), idCtx(t2))).json();
    as(d);
    const r2 = await report.POST(json("POST", { reason: "spam ou propaganda" }), idCtx(m2.message.id));
    const rep2 = (await getReport((await r2.json()).id))!;
    expect(rep2.hackathonId).toBeNull();
    expect(rep2.routedTo).toBe("admin");
  });
});

describe("LGPD e export", () => {
  it("excluir qualquer lado apaga a conversa inteira; export traz as próprias linhas", async () => {
    const a = await member();
    const b = await member();
    await follow(a, b);
    as(a);
    const { root } = await routes();
    await root.POST(post(b.username, "segredo entre a gente"));
    const tid = (await threadIdOf(a, b))!;
    const exp = await exportMemberData(a.id);
    expect(exp!.data["dm_messages.memberId"]).toHaveLength(1);
    await deleteMemberData(b.id);
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM dm_threads WHERE id = ?").get<{ n: number }>(tid)).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM dm_messages WHERE \"threadId\" = ?").get<{ n: number }>(tid)).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM dm_reads WHERE \"threadId\" = ?").get<{ n: number }>(tid)).toEqual({ n: 0 });
  });
});
