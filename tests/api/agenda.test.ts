import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { decideAccess } from "@/lib/access";
import { listCommunityUpdates, updateHref } from "@/lib/follows";
import { listCommunityMeetups, listStageRequests, upcomingMeetups } from "@/lib/meetups";
import { deleteMemberData } from "@/lib/privacy";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";

// Agenda da comunidade (migration 051): permissões (401/403/404), publicar
// avisa membros e quem segue e aparece no feed, embed só YouTube/Twitch
// (400), lotação ("vou" vira "talvez" com "lotado"), cancelar avisa quem
// respondeu, palco do demo day (projeto alheio 403), .ics com o horário
// certo, teaser público e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(): Promise<M> {
  const tag = `ag${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
type C = { id: number; slug: string; dono: M; org: M; membro: M; fan: M };
let cseq = 0;
async function community(opts: { hidden?: number } = {}): Promise<C> {
  const slug = `agenda-c${cseq++}`;
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, hidden) VALUES (?, ?, 'Recife, PE', ?) RETURNING id")
    .get<{ id: number }>(slug, `Hack ${slug}`, opts.hidden ?? 0);
  const [dono, org, membro, fan] = [await member(), await member(), await member(), await member()];
  for (const [m, role] of [
    [dono, "dono"],
    [org, "organizador"],
    [membro, "membro"],
  ] as const) {
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)").run(c!.id, m.id, role);
  }
  await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(c!.id, fan.id);
  return { id: c!.id, slug, dono, org, membro, fan };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const jreq = (method: string, body?: unknown) =>
  new Request("http://t", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

const create = () => import("@/app/api/meetups/route");
const item = () => import("@/app/api/meetups/[id]/route");
const publish = () => import("@/app/api/meetups/[id]/publish/route");
const cancel = () => import("@/app/api/meetups/[id]/cancel/route");
const rsvp = () => import("@/app/api/meetups/[id]/rsvp/route");
const stage = () => import("@/app/api/meetups/[id]/stage/route");
const decide = () => import("@/app/api/meetups/[id]/stage/[requestId]/route");
const ics = () => import("@/app/agenda/[id]/evento.ics/route");

const BASE = { kind: "meetup", title: "Rust na prática", startsAt: "2027-03-10T19:00", location: "UFPE, Recife" };

async function make(c: C, extra: Record<string, unknown> = {}, by: M = c.org): Promise<number> {
  as(by);
  const r = await (await create()).POST(jreq("POST", { community: c.slug, ...BASE, ...extra }));
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
  return (await r.json()).id;
}
async function notes(m: M, type = "meetup") {
  return db
    .prepare("SELECT text, href, actorId AS \"actorId\" FROM notifications WHERE memberId = ? AND type = ? ORDER BY id")
    .all<{ text: string; href: string; actorId: number | null }>(m.id, type);
}
async function project(owner: M, title = "Vaga Fácil"): Promise<number> {
  const hid = `ag-h-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'Edição antiga', 'Org', '2026-05-05T09:00:00-03:00', 'presencial', '', '[]', 1, 'painel')`,
    )
    .run(hid);
  const t = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id").get<{ id: number }>(hid, `Time ${title}`);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, owner.username);
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, ?)").run(t!.id, title);
  return t!.id;
}

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("criar e publicar", () => {
  it("401 deslogado em toda rota de escrita", async () => {
    const c = await community();
    const id = await make(c);
    as(null);
    expect((await (await create()).POST(jreq("POST", { community: c.slug, ...BASE }))).status).toBe(401);
    expect((await (await item()).PATCH(jreq("PATCH", BASE), ctx(id))).status).toBe(401);
    expect((await (await publish()).POST(jreq("POST"), ctx(id))).status).toBe(401);
    expect((await (await cancel()).POST(jreq("POST"), ctx(id))).status).toBe(401);
    expect((await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id))).status).toBe(401);
    expect((await (await stage()).POST(jreq("POST", { teamId: 1, pitch: "x" }), ctx(id))).status).toBe(401);
    const body = await (await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id))).json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("membro comum e quem só segue não criam (403); comunidade escondida ou inexistente é 404", async () => {
    const c = await community();
    const { POST } = await create();
    for (const m of [c.membro, c.fan]) {
      as(m);
      expect((await POST(jreq("POST", { community: c.slug, ...BASE }))).status).toBe(403);
    }
    const h = await community({ hidden: 1 });
    as(h.dono);
    expect((await POST(jreq("POST", { community: h.slug, ...BASE }))).status).toBe(404);
    expect((await POST(jreq("POST", { community: "nao-existe", ...BASE }))).status).toBe(404);
    expect((await POST(jreq("POST", { ...BASE }))).status).toBe(404);
  });

  it("rascunho não avisa ninguém e só quem organiza vê; publicar avisa membros e quem segue, uma vez", async () => {
    const c = await community();
    const outsider = await member();
    const id = await make(c);
    expect(await notes(c.membro)).toHaveLength(0);

    // rascunho: membro não responde nem vê (404)
    as(c.membro);
    expect((await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id))).status).toBe(404);
    expect((await (await publish()).POST(jreq("POST"), ctx(id))).status).toBe(404);

    as(c.dono);
    const p = await (await publish()).POST(jreq("POST"), ctx(id));
    expect(p.status).toBe(200);
    // dono, membro e seguidor; quem criou (org) não se avisa
    expect((await p.json()).notified).toBe(3);
    for (const m of [c.dono, c.membro, c.fan]) {
      const n = await notes(m);
      expect(n).toHaveLength(1);
      expect(n[0].href).toBe(`/agenda/${id}`);
      expect(n[0].actorId).toBe(c.org.id);
      expect(n[0].text).toMatch(/marcou um meetup: Rust na prática/);
    }
    expect(await notes(c.org)).toHaveLength(0);
    expect(await notes(outsider)).toHaveLength(0);
    // de novo: 409 e ninguém recebe outra
    expect((await (await publish()).POST(jreq("POST"), ctx(id))).status).toBe(409);
    expect(await notes(c.fan)).toHaveLength(1);
  });

  it("publish: true no criar já publica; aparece no feed das comunidades e no bloco da página", async () => {
    const c = await community();
    const id = await make(c, { kind: "live", title: "Live de Go", location: "", embedUrl: "https://youtu.be/dQw4w9WgXcQ", publish: true });
    expect((await notes(c.fan))[0].text).toMatch(/marcou uma live: Live de Go/);
    const feed = await listCommunityUpdates(c.fan.id);
    const u = feed.find((x) => x.kind === "agenda");
    expect(u).toMatchObject({ id: String(id), title: "Live de Go", communitySlug: c.slug, startsAt: "2027-03-10 22:00:00" });
    expect(updateHref(u!)).toBe(`/agenda/${id}`);
    expect((await upcomingMeetups(c.id)).map((m) => m.id)).toEqual([id]);
    const stored = await db.prepare("SELECT embedUrl AS \"embedUrl\" FROM meetups WHERE id = ?").get<{ embedUrl: string }>(id);
    expect(stored!.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("embed de domínio estranho dá 400 e não grava", async () => {
    const c = await community();
    as(c.org);
    const before = await db.prepare("SELECT COUNT(*)::int AS n FROM meetups").get<{ n: number }>();
    for (const embedUrl of ["https://vimeo.com/1234", "https://evil.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)"]) {
      const r = await (await create()).POST(jreq("POST", { community: c.slug, ...BASE, embedUrl }));
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/YouTube ou da Twitch/);
    }
    const after = await db.prepare("SELECT COUNT(*)::int AS n FROM meetups").get<{ n: number }>();
    expect(after!.n).toBe(before!.n);
    // na edição também
    const id = await make(c);
    const r = await (await item()).PATCH(jreq("PATCH", { ...BASE, embedUrl: "https://vimeo.com/1" }), ctx(id));
    expect(r.status).toBe(400);
  });

  it("comunidade escondida some do feed e da agenda, e não publica", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    const draft = await make(c);
    await db.prepare("UPDATE communities SET hidden = 1 WHERE id = ?").run(c.id);
    expect((await listCommunityUpdates(c.fan.id)).some((u) => u.kind === "agenda")).toBe(false);
    as(c.membro);
    expect((await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id))).status).toBe(404);
    as(c.dono);
    expect((await (await publish()).POST(jreq("POST"), ctx(draft))).status).toBe(404);
  });

  it("rate limit 'meetups': 10 por dia entre criar e editar, depois 429", async () => {
    expect(RATE_LIMITS.meetups).toEqual({ limit: 10, windowMs: 24 * 60 * 60 * 1000 });
    const c = await community();
    const id = await make(c);
    for (let i = 0; i < 9; i++) {
      expect((await (await item()).PATCH(jreq("PATCH", { ...BASE, title: `Rust ${i}` }), ctx(id))).status).toBe(200);
    }
    const r = await (await create()).POST(jreq("POST", { community: c.slug, ...BASE }));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("editar e cancelar", () => {
  it("mudar o horário sobe a SEQUENCE e avisa quem respondeu", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    as(c.membro);
    await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id));
    as(c.org);
    const same = await (await item()).PATCH(jreq("PATCH", { ...BASE, title: "Rust na prática II" }), ctx(id));
    expect(await same.json()).toMatchObject({ timeChanged: false, notified: 0 });
    const moved = await (await item()).PATCH(jreq("PATCH", { ...BASE, startsAt: "2027-03-11T19:00" }), ctx(id));
    expect(await moved.json()).toMatchObject({ timeChanged: true, notified: 1 });
    const n = (await notes(c.membro)).at(-1)!;
    expect(n.text).toMatch(/mudou de horário/);
    const row = await db.prepare("SELECT sequence FROM meetups WHERE id = ?").get<{ sequence: number }>(id);
    expect(row!.sequence).toBe(1);
    as(c.membro);
    expect((await (await item()).PATCH(jreq("PATCH", BASE), ctx(id))).status).toBe(403);
  });

  it("cancelar avisa quem respondeu; depois não aceita RSVP nem outro cancelar", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    for (const m of [c.membro, c.fan]) {
      as(m);
      expect((await (await rsvp()).POST(jreq("POST", { status: m === c.fan ? "talvez" : "vou" }), ctx(id))).status).toBe(200);
    }
    as(c.membro);
    expect((await (await cancel()).POST(jreq("POST"), ctx(id))).status).toBe(403);
    as(c.dono);
    const r = await (await cancel()).POST(jreq("POST"), ctx(id));
    expect(await r.json()).toEqual({ cancelled: true, notified: 2 });
    for (const m of [c.membro, c.fan]) expect((await notes(m, "meetup_cancelado"))[0].text).toMatch(/cancelou Rust na prática/);
    expect(await notes(c.dono, "meetup_cancelado")).toHaveLength(0);
    expect((await (await cancel()).POST(jreq("POST"), ctx(id))).status).toBe(409);
    as(c.membro);
    expect((await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id))).status).toBe(409);
    // cancelado some do feed e do bloco, mas fica na agenda marcado
    expect((await listCommunityUpdates(c.fan.id)).some((u) => u.kind === "agenda")).toBe(false);
    expect(await upcomingMeetups(c.id)).toHaveLength(0);
    expect((await listCommunityMeetups(c.id)).upcoming[0].cancelledAt).toBeTruthy();
  });

  it("rascunho se apaga; publicado não (409)", async () => {
    const c = await community();
    const draft = await make(c);
    const pub = await make(c, { publish: true });
    as(c.org);
    expect((await (await item()).DELETE(jreq("DELETE"), ctx(pub))).status).toBe(409);
    expect((await (await item()).DELETE(jreq("DELETE"), ctx(draft))).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM meetups WHERE id = ?").get(draft)).toBeUndefined();
  });

  it("quem conduz: @ desconhecido dá 400; sem ninguém, quem criou conduz", async () => {
    const c = await community();
    as(c.org);
    const r = await (await create()).POST(jreq("POST", { community: c.slug, ...BASE, hosts: "@nao_existe_ninguem" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Não achamos @nao_existe_ninguem/);
    const id = await make(c);
    const hosts = await db.prepare("SELECT memberId AS \"memberId\" FROM meetup_hosts WHERE meetupId = ?").all<{ memberId: number }>(id);
    expect(hosts.map((h) => h.memberId)).toEqual([c.org.id]);
    const id2 = await make(c, { hosts: `@${c.membro.username} @${c.dono.username}` });
    const h2 = await db.prepare("SELECT memberId AS \"memberId\" FROM meetup_hosts WHERE meetupId = ? ORDER BY memberId").all<{ memberId: number }>(id2);
    expect(h2.map((h) => h.memberId).sort()).toEqual([c.dono.id, c.membro.id].sort());
  });
});

describe("RSVP e lotação", () => {
  it("lotação respeitada: 'vou' vira 'talvez' com 'lotado'; liberar vaga deixa entrar", async () => {
    const c = await community();
    const id = await make(c, { capacity: 1, publish: true });
    const { POST, DELETE } = await rsvp();
    as(c.membro);
    const a = await POST(jreq("POST", { status: "vou" }), ctx(id));
    expect(await a.json()).toMatchObject({ status: "vou", full: false, counts: { vou: 1, talvez: 0 } });
    // o mesmo "vou" de novo não conta duas vezes
    expect(await (await POST(jreq("POST", { status: "vou" }), ctx(id))).json()).toMatchObject({ status: "vou", full: false });

    as(c.fan);
    const b = await POST(jreq("POST", { status: "vou" }), ctx(id));
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ status: "talvez", full: true, message: "lotado", counts: { vou: 1, talvez: 1 } });

    as(c.membro);
    expect(await (await DELETE(jreq("DELETE"), ctx(id))).json()).toMatchObject({ removed: true, counts: { vou: 0, talvez: 1 } });
    as(c.fan);
    expect(await (await POST(jreq("POST", { status: "vou" }), ctx(id))).json()).toMatchObject({ status: "vou", full: false });
  });

  it("status inválido é 400; quem não está na comunidade também responde evento publicado", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    const qualquer = await member();
    as(qualquer);
    expect((await (await rsvp()).POST(jreq("POST", { status: "sim" }), ctx(id))).status).toBe(400);
    expect((await (await rsvp()).POST(jreq("POST", { status: "talvez" }), ctx(id))).status).toBe(200);
    expect((await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx("abc"))).status).toBe(404);
    expect((await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(999999))).status).toBe(404);
  });

  it("evento que já passou não recebe resposta", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    await db.prepare("UPDATE meetups SET startsAt = '2020-01-01 12:00:00', endsAt = NULL WHERE id = ?").run(id);
    as(c.membro);
    const r = await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id));
    expect(r.status).toBe(409);
    expect((await listCommunityMeetups(c.id)).past.map((m) => m.id)).toEqual([id]);
  });

  it("rate limit do RSVP por membro", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    as(c.membro);
    const { POST } = await rsvp();
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await POST(jreq("POST", { status: i % 2 ? "vou" : "talvez" }), ctx(id))).status;
    expect(last).toBe(429);
  });
});

describe("palco do demo day", () => {
  it("projeto alheio dá 403; o próprio entra; repetir é 409; organizador aceita e quem pediu recebe o aviso", async () => {
    const c = await community();
    const id = await make(c, { kind: "demo_day", title: "Demo day de março", publish: true });
    const meu = await project(c.membro, "Vaga Fácil");
    const alheio = await project(c.fan, "Outro App");
    const { POST } = await stage();
    as(c.membro);
    const r403 = await POST(jreq("POST", { teamId: alheio, pitch: "quero mostrar" }), ctx(id));
    expect(r403.status).toBe(403);
    expect((await POST(jreq("POST", { teamId: meu, pitch: "" }), ctx(id))).status).toBe(400);
    expect((await POST(jreq("POST", { teamId: meu, pitch: "x".repeat(281) }), ctx(id))).status).toBe(400);
    const ok = await POST(jreq("POST", { teamId: meu, pitch: "App que acha vaga de estágio pelo GitHub." }), ctx(id));
    expect(ok.status).toBe(201);
    const { id: reqId } = await ok.json();
    expect((await POST(jreq("POST", { teamId: meu, pitch: "de novo" }), ctx(id))).status).toBe(409);

    // membro não decide
    const { PATCH } = await decide();
    const rctx = { params: Promise.resolve({ id: String(id), requestId: String(reqId) }) };
    expect((await PATCH(jreq("PATCH", { status: "aceito" }), rctx)).status).toBe(403);
    as(c.org);
    expect((await PATCH(jreq("PATCH", { status: "talvez" }), rctx)).status).toBe(400);
    expect((await PATCH(jreq("PATCH", { status: "aceito" }), rctx)).status).toBe(200);
    const program = await listStageRequests(id, { status: "aceito" });
    expect(program.map((s) => s.title)).toEqual(["Vaga Fácil"]);
    expect((await notes(c.membro, "meetup_palco"))[0].text).toMatch(/entrou na programação de Demo day de março/);
    // pedido de outro evento não se decide por aqui
    const outro = await make(c, { kind: "demo_day", publish: true });
    const octx = { params: Promise.resolve({ id: String(outro), requestId: String(reqId) }) };
    expect((await PATCH(jreq("PATCH", { status: "recusado" }), octx)).status).toBe(404);
  });

  it("palco só no demo day", async () => {
    const c = await community();
    const id = await make(c, { publish: true });
    const meu = await project(c.membro);
    as(c.membro);
    const r = await (await stage()).POST(jreq("POST", { teamId: meu, pitch: "oi" }), ctx(id));
    expect(r.status).toBe(400);
  });
});

describe(".ics e teaser", () => {
  it(".ics abre com o horário certo (19:00 de Brasília = 22:00 UTC) e sem o link da sala", async () => {
    const c = await community();
    const id = await make(c, { endsAt: "2027-03-10T21:30", onlineUrl: "https://meet.google.com/abc-defg-hij", publish: true });
    as(c.fan);
    const r = await (await ics()).GET(jreq("GET"), ctx(id));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toMatch(/text\/calendar/);
    const body = await r.text();
    expect(body).toContain("DTSTART:20270310T220000Z");
    expect(body).toContain("DTEND:20270311T003000Z");
    expect(body).toContain("SUMMARY:Rust na prática · Hack ");
    expect(body).toContain(`UID:meetup-${id}@hackahub`);
    expect(body).not.toContain("meet.google.com");
    as(null);
    expect((await (await ics()).GET(jreq("GET"), ctx(id))).status).toBe(401);
  });

  it(".ics de rascunho alheio é 404; de cancelado é 410", async () => {
    const c = await community();
    const draft = await make(c);
    const pub = await make(c, { publish: true });
    as(c.membro);
    expect((await (await ics()).GET(jreq("GET"), ctx(draft))).status).toBe(404);
    as(c.org);
    await (await cancel()).POST(jreq("POST"), ctx(pub));
    expect((await (await ics()).GET(jreq("GET"), ctx(pub))).status).toBe(410);
  });

  it("/agenda/[id] é teaser público; editar e .ics pedem conta", () => {
    const anon = { signedIn: false, onboarded: false };
    expect(decideAccess("/agenda/12", anon)).toBe("next");
    expect(decideAccess("/agenda/12/editar", anon)).toBe("signup");
    expect(decideAccess("/agenda/12/evento.ics", anon)).toBe("signup");
    expect(decideAccess("/comunidade/x/agenda", anon)).toBe("signup");
    expect(decideAccess("/api/meetups", anon)).toBe("unauthorized");
  });
});

describe("LGPD", () => {
  it("excluir a conta apaga RSVP, condução e pedido de palco; o evento fica", async () => {
    const c = await community();
    const id = await make(c, { kind: "demo_day", hosts: `@${c.membro.username}`, publish: true });
    const meu = await project(c.membro);
    as(c.membro);
    await (await rsvp()).POST(jreq("POST", { status: "vou" }), ctx(id));
    await (await stage()).POST(jreq("POST", { teamId: meu, pitch: "demo" }), ctx(id));
    await deleteMemberData(c.membro.id);
    for (const t of ["meetup_rsvps", "meetup_hosts", "meetup_stage_requests"]) {
      const r = await db.prepare(`SELECT COUNT(*)::int AS n FROM ${t} WHERE memberId = ?`).get<{ n: number }>(c.membro.id);
      expect(r!.n, t).toBe(0);
    }
    expect(await db.prepare("SELECT 1 AS y FROM meetups WHERE id = ?").get(id)).toBeTruthy();
  });
});
