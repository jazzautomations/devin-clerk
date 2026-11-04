import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { deleteMemberData } from "@/lib/privacy";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";
import {
  DECLINE_LOCK,
  GENERIC_CODE_ERROR,
  MAX_PENDING,
  PENDING_TTL_MIN,
  listConnections,
  meetState,
  myMeet,
  optInEncounters,
  pauseEncounters,
  readMeetCode,
  respondEncounter,
  setEncounterSide,
} from "@/lib/encounters";
import { createReport } from "@/lib/reports";

// Encontros na edição (spec 046, onda 5 — migration 050): portas (inscrição,
// check-in, 18+ e aceite), código lido sem confirmação não conta, resposta
// genérica pra código inválido/bloqueado/pausado, um encontro por par, 15 min
// de validade, contato só depois de confirmado, profundidade só mútua, fila
// offline, missões ligadas pelo organizador, painel só agregado e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "encontros-api-2026";

let seq = 0;
type M = { id: number; clerkId: string; username: string; name: string };

async function member(extra: Record<string, unknown> = {}): Promise<M> {
  const tag = `ea${seq++}`;
  const cols = Object.keys(extra);
  const row = await db
    .prepare(
      `INSERT INTO members ("clerkId", username, email, name${cols.length ? `, ${cols.map((c) => `"${c}"`).join(", ")}` : ""})
       VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")}) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, ...Object.values(extra));
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, name: `Pessoa ${tag}` };
}

async function enrolled(m: M, opts: { checkin?: boolean; hackathonId?: string } = {}): Promise<void> {
  const hackathonId = opts.hackathonId ?? H;
  const reg = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(m.id, hackathonId);
  if (opts.checkin !== false) await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(reg!.id);
  await optInEncounters(m.id, hackathonId);
}

const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const json = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ctx2 = (id: string, encounterId: number | string) => ({
  params: Promise.resolve({ id, encounterId: String(encounterId) }),
});

const routes = async () => ({
  root: await import("@/app/api/hackathons/[id]/encounters/route"),
  me: await import("@/app/api/hackathons/[id]/encounters/me/route"),
  one: await import("@/app/api/hackathons/[id]/encounters/[encounterId]/route"),
  sync: await import("@/app/api/hackathons/[id]/encounters/sync/route"),
  intro: await import("@/app/api/hackathons/[id]/encounters/introductions/route"),
  admin: await import("@/app/api/admin/hackathons/[id]/encounters/route"),
});

const codeOf = async (m: M) => (await myMeet(m.id, H))!.code;
const notifications = (memberId: number, type = "encontro") =>
  db.prepare("SELECT text FROM notifications WHERE memberId = ? AND type = ?").all<{ text: string }>(memberId, type);

beforeEach(async () => {
  resetRateLimits();
  as(null);
  for (const table of [
    "introductions",
    "encounter_declines",
    "encounter_sides",
    "encounters",
    "edition_meet_codes",
    "edition_roles",
    "notifications",
    "reports",
    "incidents",
    "member_blocks",
    // inscrição e presença de um caso não podem contaminar o agregado do outro
    "checkins",
    "registrations",
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
  // janela aberta: começou há 2 h e termina daqui a 8 h
  const startsAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  const endsAt = new Date(Date.now() + 8 * 3600_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source, "encountersOn", "encounterMissionsOn")
       VALUES (?, 'Encontros 2026', 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel', 1, 0)
       ON CONFLICT (id) DO UPDATE SET "startsAt" = excluded."startsAt", "endsAt" = excluded."endsAt",
         "encountersOn" = 1, "encounterMissionsOn" = 0`,
    )
    .run(H, startsAt, endsAt);
});

describe("portas", () => {
  it("401 deslogado em toda rota", async () => {
    const r = await routes();
    const ana = await member();
    await enrolled(ana);
    as(null);
    for (const res of [
      await r.root.GET(new Request("http://t"), ctx(H)),
      await r.root.POST(json("POST", { code: "ABCDE" }), ctx(H)),
      await r.me.POST(json("POST", { enabled: true }), ctx(H)),
      await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, 1)),
      await r.sync.POST(json("POST", { items: [{ code: "ABCDE" }] }), ctx(H)),
      await r.intro.POST(json("POST", { peer: "a", recipient: "b" }), ctx(H)),
      await r.admin.POST(json("POST", { on: true }), ctx(H)),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("sem check-in: a tela explica e a leitura dá 403", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana, { checkin: false });
    await enrolled(bia);
    as(ana);
    const state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.gate).toMatchObject({ ok: false, reason: "checkin" });
    const res = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("checkin");
  });

  it("sem o aceite: 403 na leitura, e POST /me cria o código com o canal escolhido", async () => {
    const r = await routes();
    const ana = await member({ linkedin: "https://linkedin.com/in/ana" });
    const reg = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .get<{ id: number }>(ana.id, H);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(reg!.id);
    as(ana);
    const before = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(before.gate).toMatchObject({ ok: false, reason: "consent" });
    expect(before.me).toBeNull();
    const bia = await member();
    await enrolled(bia);
    const denied = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(denied.status).toBe(403);
    expect((await denied.json()).reason).toBe("consent");

    const created = await r.me.POST(json("POST", { enabled: true, channel: "github", newcomerOptIn: true }), ctx(H));
    expect(created.status).toBe(201);
    const me = (await created.json()).me;
    expect(me.code).toMatch(/^[2-9A-HJ-NP-Z]{5}$/);
    expect(me.channel).toBe("github");
    expect(me.newcomerOptIn).toBe(true);
    // intros nascem desligadas
    expect(me.introOptIn).toBe(false);
    const after = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(after.gate.ok).toBe(true);
  });

  it("edição com encontros desligados: 403 com motivo, tela diz o mesmo", async () => {
    const r = await routes();
    const ana = await member();
    await enrolled(ana);
    await db.prepare(`UPDATE hackathons SET "encountersOn" = 0 WHERE id = ?`).run(H);
    as(ana);
    const state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.enabled).toBe(false);
    const res = await r.root.POST(json("POST", { code: "ABCDE" }), ctx(H));
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("off");
  });
});

describe("ler o código", () => {
  it("pendente não mostra contato e avisa a outra pessoa; confirmar mostra o contato pros dois", async () => {
    const r = await routes();
    const ana = await member({ linkedin: "https://linkedin.com/in/ana" });
    const bia = await member({ linkedin: "https://linkedin.com/in/bia" });
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const res = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.peer.contact).toBeNull();
    expect((await notifications(bia.id)).map((n) => n.text)).toEqual([`@${ana.username} quer registrar o encontro`]);

    const state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.pendingOut).toHaveLength(1);
    expect(state.pendingOut[0].peer.contact).toBeNull();
    expect(state.pendingIn).toHaveLength(0);

    // quem pediu não confirma o próprio pedido
    as(ana);
    const own = await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, body.encounterId));
    expect(own.status).toBe(403);

    // a outra pessoa confirma e o contato aparece pros dois
    as(bia);
    const confirmed = await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, body.encounterId));
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).encounter.peer.contact).toEqual({
      channel: "linkedin",
      label: "LinkedIn",
      value: "https://linkedin.com/in/ana",
    });
    const mine = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(mine.confirmed).toHaveLength(1);
    // do lado de B o cartão é o de A
    expect(mine.confirmed[0].peer.contact.value).toBe("https://linkedin.com/in/ana");
    // o pedido confirmado avisa quem pediu
    expect((await notifications(ana.id)).map((n) => n.text)).toContain(
      `@${bia.username} confirmou o encontro com você`,
    );
  });

  it("segundo encontro do mesmo par na edição dá 409", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const first = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await first.json()).encounterId;
    // repetir antes da confirmação também não cria outro
    const again = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(again.status).toBe(409);
    expect((await again.json()).kind).toBe("pending");
    as(bia);
    await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, id));
    as(ana);
    const third = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(third.status).toBe(409);
    expect((await third.json()).kind).toBe("already");
    const rows = await db.prepare(`SELECT COUNT(*)::int AS n FROM encounters WHERE "hackathonId" = ?`).get<{ n: number }>(H);
    expect(Number(rows?.n)).toBe(1);
  });

  it("código inválido, pausado, de quem bloqueou e de quem recusou 3 vezes: a MESMA resposta", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    const caio = await member();
    const dani = await member();
    for (const m of [ana, bia, caio, dani]) await enrolled(m);
    as(ana);

    const invalid = await r.root.POST(json("POST", { code: "ZZZZZ" }), ctx(H));
    expect(invalid.status).toBe(404);
    const generic = await invalid.json();
    expect(generic).toEqual({ error: GENERIC_CODE_ERROR, kind: "not_found" });

    // pausado
    await pauseEncounters(bia.id, H, true);
    const paused = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(paused.status).toBe(404);
    expect(await paused.json()).toEqual(generic);
    await pauseEncounters(bia.id, H, false);

    // bloqueou
    await block(caio.id, ana.id);
    const blocked = await r.root.POST(json("POST", { code: await codeOf(caio) }), ctx(H));
    expect(blocked.status).toBe(404);
    expect(await blocked.json()).toEqual(generic);

    // 3 recusas travam o par
    for (let i = 0; i < DECLINE_LOCK; i++) {
      as(ana);
      const req = await r.root.POST(json("POST", { code: await codeOf(dani) }), ctx(H));
      expect(req.status).toBe(201);
      as(dani);
      await r.one.PATCH(json("PATCH", { action: "decline" }), ctx2(H, (await req.clone().json()).encounterId));
    }
    as(ana);
    const locked = await r.root.POST(json("POST", { code: await codeOf(dani) }), ctx(H));
    expect(locked.status).toBe(404);
    expect(await locked.json()).toEqual(generic);
    // quem recusou não é avisado de nada
    expect(await notifications(ana.id)).toHaveLength(0);
  });

  it("ler o QR de quem pediu confirma o encontro", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    as(bia);
    const back = await r.root.POST(json("POST", { code: await codeOf(ana) }), ctx(H));
    expect(back.status).toBe(201);
    const body = await back.json();
    expect(body.status).toBe("confirmed");
    const rows = await db
      .prepare(`SELECT status FROM encounters WHERE "hackathonId" = ?`)
      .all<{ status: string }>(H);
    expect(rows).toEqual([{ status: "confirmed" }]);
  });

  it("recusar não avisa quem pediu, e o par pode tentar de novo", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await req.json()).encounterId;
    as(bia);
    await r.one.PATCH(json("PATCH", { action: "decline" }), ctx2(H, id));
    expect(await notifications(ana.id)).toHaveLength(0);
    as(ana);
    const again = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    expect(again.status).toBe(201);
    expect((await again.json()).status).toBe("pending");
  });

  it("no máximo 5 pendentes por pessoa", async () => {
    const r = await routes();
    const ana = await member();
    await enrolled(ana);
    const others: M[] = [];
    for (let i = 0; i < MAX_PENDING + 1; i++) {
      const m = await member();
      await enrolled(m);
      others.push(m);
    }
    as(ana);
    for (let i = 0; i < MAX_PENDING; i++) {
      const res = await r.root.POST(json("POST", { code: await codeOf(others[i]) }), ctx(H));
      expect(res.status).toBe(201);
    }
    const over = await r.root.POST(json("POST", { code: await codeOf(others[MAX_PENDING]) }), ctx(H));
    expect(over.status).toBe(409);
    expect((await over.json()).kind).toBe("limit");
  });

  it("30 leituras por hora e depois 429", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const code = await codeOf(bia);
    for (let i = 0; i < RATE_LIMITS.encounters.limit; i++) {
      const res = await r.root.POST(json("POST", { code }), ctx(H));
      expect(res.status).not.toBe(429);
    }
    const limited = await r.root.POST(json("POST", { code }), ctx(H));
    expect(limited.status).toBe(429);
  });
});

describe("como foi a conversa", () => {
  it("profundidade só conta quando os dois marcam além do oi", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await req.json()).encounterId;
    as(bia);
    await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, id));

    as(ana);
    const mine = await r.one.PATCH(json("PATCH", { depth: "alem" }), ctx2(H, id));
    expect(mine.status).toBe(200);
    let state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.confirmed[0].side.depth).toBe("alem");
    expect(state.confirmed[0].deep).toBe(false);
    expect(state.counts).toMatchObject({ people: 1, deep: 0 });

    as(bia);
    await r.one.PATCH(json("PATCH", { depth: "rapido" }), ctx2(H, id));
    as(ana);
    state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.confirmed[0].deep).toBe(false);
    expect(state.counts.deep).toBe(0);

    as(bia);
    await r.one.PATCH(json("PATCH", { depth: "alem" }), ctx2(H, id));
    as(ana);
    state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.confirmed[0].deep).toBe(true);
    expect(state.counts.deep).toBe(1);
  });

  it("carta, nota privada e esconder: a nota nunca aparece pro outro lado", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await req.json()).encounterId;
    as(bia);
    await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, id));
    as(ana);
    const saved = await r.one.PATCH(json("PATCH", { cardKey: "funda-bug", note: "  bug do cache  " }), ctx2(H, id));
    expect(saved.status).toBe(200);
    const view = (await saved.json()).encounter;
    expect(view.side.cardKey).toBe("funda-bug");
    expect(view.side.cardText).toBe("Pior bug da sua vida?");
    expect(view.side.note).toBe("bug do cache");

    as(bia);
    const theirs = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(theirs.confirmed[0].side.note).toBeNull();
    expect(theirs.confirmed[0].side.cardKey).toBeNull();

    // carta desconhecida e nota longa são 400
    as(ana);
    expect((await r.one.PATCH(json("PATCH", { cardKey: "nao-existe" }), ctx2(H, id))).status).toBe(400);
    expect((await r.one.PATCH(json("PATCH", { note: "x".repeat(281) }), ctx2(H, id))).status).toBe(400);

    // esconder tira da minha lista e não da dela
    expect((await r.one.PATCH(json("PATCH", { hide: true }), ctx2(H, id))).status).toBe(200);
    expect((await (await r.root.GET(new Request("http://t"), ctx(H))).json()).confirmed).toHaveLength(0);
    as(bia);
    expect((await (await r.root.GET(new Request("http://t"), ctx(H))).json()).confirmed).toHaveLength(1);
    expect((await listConnections(ana.id, ana.username)).length).toBe(0);
  });

  it("antes de confirmar não dá pra responder como foi", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await req.json()).encounterId;
    const res = await r.one.PATCH(json("PATCH", { depth: "alem" }), ctx2(H, id));
    expect(res.status).toBe(409);
  });
});

describe("validade de 15 minutos", () => {
  it("pendente vencido não confirma e vira expirado", async () => {
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    const now = new Date();
    const r = await readMeetCode(ana, H, await codeOf(bia), now);
    expect(r.ok).toBe(true);
    const id = r.ok ? r.encounterId : 0;
    const late = new Date(now.getTime() + (PENDING_TTL_MIN + 1) * 60_000);
    await expect(respondEncounter(bia, id, "confirm", late)).rejects.toThrow(/expirou/);
    const row = await db.prepare("SELECT status FROM encounters WHERE id = ?").get<{ status: string }>(id);
    expect(row).toEqual({ status: "expired" });
    // e a tela não mostra mais o pedido
    const state = await meetState(ana, H, late);
    expect(state.pendingOut).toHaveLength(0);
  });
});

describe("fila offline", () => {
  it("a fila sobe em lote e o servidor revalida cada código", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const res = await r.sync.POST(
      json("POST", { items: [{ code: await codeOf(bia) }, { code: "ZZZZZ" }] }),
      ctx(H),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toMatchObject({ ok: true });
    expect(body.results[1]).toMatchObject({ ok: false, kind: "not_found", message: GENERIC_CODE_ERROR });
    expect(body.state.pendingOut).toHaveLength(1);
  });

  it("fila vazia ou grande demais é 400", async () => {
    const r = await routes();
    const ana = await member();
    await enrolled(ana);
    as(ana);
    expect((await r.sync.POST(json("POST", { items: [] }), ctx(H))).status).toBe(400);
    const many = Array.from({ length: 21 }, () => ({ code: "ABCDE" }));
    expect((await r.sync.POST(json("POST", { items: many }), ctx(H))).status).toBe(400);
  });
});

describe("missões e organizador", () => {
  it("missões desligadas por padrão; organizador liga e só ele pode", async () => {
    const r = await routes();
    const org = await member();
    const ana = await member();
    await enrolled(org);
    await enrolled(ana);
    await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')").run(H, org.id);

    as(ana);
    const state = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(state.missionsOn).toBe(false);
    expect(state.missions).toEqual([]);
    expect((await r.admin.POST(json("POST", { on: false }), ctx(H))).status).toBe(403);

    as(org);
    const off = await (await r.admin.POST(json("POST", { missions: true }), ctx(H))).json();
    expect(off.missionsOn).toBe(true);
    expect(off.encountersOn).toBe(true);

    as(ana);
    const withMissions = await (await r.root.GET(new Request("http://t"), ctx(H))).json();
    expect(withMissions.missions.map((m: { key: string }) => m.key)).toEqual([
      "primeira-viagem",
      "mentor",
      "outra-faculdade",
      "ponte",
    ]);
  });

  it("painel mostra só agregado, sem nome, e N < 5 vira poucos dados", async () => {
    const r = await routes();
    const org = await member();
    const ana = await member();
    const bia = await member();
    for (const m of [org, ana, bia]) await enrolled(m);
    await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')").run(H, org.id);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    as(bia);
    await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, (await req.clone().json()).encounterId));

    as(org);
    const body = await (await r.admin.GET(new Request("http://t"), ctx(H))).json();
    expect(body.stats.poucosDados).toBe(true);
    expect(body.stats.presentes).toBe(3);
    expect(body.stats.comEncontro).toBe(2);
    const dump = JSON.stringify(body);
    expect(dump).not.toContain(ana.username);
    expect(dump).not.toContain(bia.username);
    expect(dump).not.toContain("Pessoa ");
  });

  it("apresentar duas pessoas: 201, duplicada 409, quem não está inscrito 400", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    const caio = await member();
    const fora = await member();
    for (const m of [ana, bia, caio]) await enrolled(m);
    as(ana);
    const ok = await r.intro.POST(json("POST", { peer: bia.username, recipient: caio.username }), ctx(H));
    expect(ok.status).toBe(201);
    const dup = await r.intro.POST(json("POST", { peer: bia.username, recipient: caio.username }), ctx(H));
    expect(dup.status).toBe(409);
    const bad = await r.intro.POST(json("POST", { peer: bia.username, recipient: fora.username }), ctx(H));
    expect(bad.status).toBe(400);
    // as duas pessoas apresentadas são avisadas
    expect((await notifications(bia.id)).map((n) => n.text)).toContain(
      `@${ana.username} apresentou você a @${caio.username}`,
    );
  });
});

describe("denúncia e LGPD", () => {
  it("denunciar um encontro vira denúncia da edição e bloqueia a outra pessoa", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await req.json()).encounterId;
    const report = await createReport({
      targetType: "encontro",
      targetId: String(id),
      reporterId: ana.id,
      reason: "constrangimento no encontro",
    });
    expect(report.blocked).toBe(bia.username);
    const row = await db
      .prepare("SELECT targetType, hackathonId, snapshot FROM reports WHERE id = ?")
      .get<{ targetType: string; hackathonId: string; snapshot: string }>(report.id);
    expect(row?.targetType).toBe("encontro");
    expect(row?.hackathonId).toBe(H);
    expect(row?.snapshot).toContain("Encontro registrado");
    // denúncia de encontro de outra pessoa não existe pra mim
    const other = await member();
    await enrolled(other);
    await expect(
      createReport({ targetType: "encontro", targetId: String(id), reporterId: other.id, reason: "nada a ver" }),
    ).rejects.toThrow(/Não encontrado/);
  });

  it("excluir a conta apaga o encontro dos dois lados", async () => {
    const r = await routes();
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    as(ana);
    const req = await r.root.POST(json("POST", { code: await codeOf(bia) }), ctx(H));
    const id = (await req.json()).encounterId;
    as(bia);
    await r.one.PATCH(json("PATCH", { action: "confirm" }), ctx2(H, id));
    await deleteMemberData(ana.id);
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM encounters").get<{ n: number }>()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM edition_meet_codes WHERE \"memberId\" = ?").get<{ n: number }>(ana.id)).toEqual({ n: 0 });
    expect(await listConnections(bia.id, bia.username)).toHaveLength(0);
  });

  it("definir a profundidade não mexe no encontro do outro", async () => {
    const ana = await member();
    const bia = await member();
    await enrolled(ana);
    await enrolled(bia);
    const r = await readMeetCode(ana, H, await codeOf(bia));
    const id = r.ok ? r.encounterId : 0;
    await respondEncounter(bia, id, "confirm");
    await setEncounterSide(ana, id, { depth: "alem" });
    const sides = await db
      .prepare(`SELECT "memberId", depth FROM encounter_sides WHERE "encounterId" = ?`)
      .all<{ memberId: number; depth: string | null }>(id);
    // só o meu lado foi escrito: o lado do outro continua em branco
    expect(sides).toEqual([{ memberId: ana.id, depth: "alem" }]);
    const other = await db
      .prepare(`SELECT depth FROM encounter_sides WHERE "encounterId" = ? AND "memberId" = ?`)
      .get<{ depth: string | null }>(id, bia.id);
    expect(other).toBeUndefined();
  });
});
