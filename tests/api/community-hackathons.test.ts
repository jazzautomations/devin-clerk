import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getEditionRoles } from "@/lib/roles";
import { resetRateLimits } from "@/lib/ratelimit";

// Organizar sozinho: dono/organizador abre hackathon na comunidade (nasce
// rascunho e quem cria vira organizador da edição), publica pelo checklist
// sem o admin global e o anúncio vai só pros membros. Arquivar segue do admin.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string };
async function member(role = "member"): Promise<M> {
  const tag = `ch${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, role);
  return { id: row!.id, clerkId: `clerk_${tag}` };
}
const as = (m: M | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function community(slug: string, dono: M, extra: { role: "organizador" | "membro"; m: M }[] = []) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, createdBy) VALUES (?, ?, 'Recife, PE', ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, dono.id);
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')").run(c!.id, dono.id);
  for (const e of extra) {
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)").run(c!.id, e.m.id, e.role);
  }
  return c!.id;
}

const novo = { name: "Hack do Recife", startsAt: "2027-05-10T09:00", endsAt: "2027-05-11T18:00", format: "presencial", location: "Porto Digital, Recife", capacity: 80, description: "Fim de semana de cidade inteligente.", infoUrl: "https://instagram.com/hackrecife" };

async function createIn(slug: string, who: M | null, body: Record<string, unknown> = novo) {
  const { POST } = await import("@/app/api/communities/[slug]/hackathons/route");
  as(who);
  return POST(req("POST", body), { params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("POST /api/communities/[slug]/hackathons", () => {
  it("dono cria rascunho da comunidade e vira organizador da edição", async () => {
    const dono = await member();
    const cid = await community("ch-recife", dono);
    const res = await createIn("ch-recife", dono);
    expect(res.status).toBe(201);
    const { id, panel } = await res.json();
    expect(id).toBe("hack-do-recife-2027");
    expect(panel).toBe(`/admin/h/${id}`);
    const row = await db
      .prepare(
        "SELECT active, source, communityId, organizer, registrationUrl, capacity, location, startsAt, description, infoUrl, publishedAt FROM hackathons WHERE id = ?",
      )
      .get(id);
    expect(row).toEqual({
      active: 0,
      source: "painel",
      communityId: cid,
      organizer: "Comunidade ch-recife",
      registrationUrl: `/h/${id}`,
      capacity: 80,
      location: "Porto Digital, Recife",
      startsAt: "2027-05-10T09:00:00-03:00",
      description: "Fim de semana de cidade inteligente.",
      infoUrl: "https://instagram.com/hackrecife",
      publishedAt: null,
    });
    expect(await getEditionRoles(id, dono.id)).toEqual(["organizador"]);
    // mesmo nome de novo ganha sufixo, nunca sobrescreve
    const again = await createIn("ch-recife", dono);
    expect((await again.json()).id).toBe("hack-do-recife-2027-2");
  });

  it("organizador da comunidade cria; membro, de fora e organizador de OUTRA comunidade levam 403", async () => {
    const dono = await member();
    const org = await member();
    const membro = await member();
    await community("ch-a", dono, [
      { role: "organizador", m: org },
      { role: "membro", m: membro },
    ]);
    const outroDono = await member();
    const outroOrg = await member();
    await community("ch-b", outroDono, [{ role: "organizador", m: outroOrg }]);
    expect((await createIn("ch-a", null)).status).toBe(401);
    expect((await createIn("ch-a", membro)).status).toBe(403);
    expect((await createIn("ch-a", await member())).status).toBe(403);
    expect((await createIn("ch-a", outroDono, { ...novo, name: "Invasão A" })).status).toBe(403);
    expect((await createIn("ch-a", outroOrg, { ...novo, name: "Invasão B" })).status).toBe(403);
    expect((await createIn("nao-existe", dono)).status).toBe(404);
    expect((await createIn("ch-a", org, { ...novo, name: "Do Organizador" })).status).toBe(201);
    expect(
      await db.prepare("SELECT id FROM hackathons WHERE name LIKE 'Invasão%'").all(),
    ).toEqual([]);
  });

  it("valida o básico", async () => {
    const dono = await member();
    await community("ch-val", dono);
    const st = async (body: Record<string, unknown>) => {
      resetRateLimits();
      return (await createIn("ch-val", dono, body)).status;
    };
    expect(await st({ ...novo, name: "x" })).toBe(400);
    expect(await st({ ...novo, location: "" })).toBe(400);
    expect(await st({ ...novo, startsAt: "amanhã" })).toBe(400);
    expect(await st({ ...novo, endsAt: "2027-05-01T09:00" })).toBe(400);
    expect(await st({ ...novo, capacity: 0 })).toBe(400);
    expect(await st({ ...novo, format: "metaverso" })).toBe(400);
    expect(await st({ ...novo, infoUrl: "javascript:alert(1)" })).toBe(400);
    expect(await st({ ...novo, name: "Online Sem Local", format: "online", location: "" })).toBe(201);
  });

  it("rate limit: 5 por dia por pessoa, o 6º é 429", async () => {
    const dono = await member();
    await community("ch-rate", dono);
    for (let i = 0; i < 5; i++) expect((await createIn("ch-rate", dono, { ...novo, name: `Rate ${i} Hack` })).status).toBe(201);
    expect((await createIn("ch-rate", dono, { ...novo, name: "Rate 6 Hack" })).status).toBe(429);
  });
});

describe("publicar sem o admin global", () => {
  it("quem criou publica com o checklist ok; o aviso vai só pros membros; arquivar segue do admin", async () => {
    const dono = await member();
    const m1 = await member();
    const fora = await member();
    await community("ch-pub", dono, [{ role: "membro", m: m1 }]);
    const outroDono = await member();
    await community("ch-pub-outra", outroDono);
    const { id } = await (await createIn("ch-pub", dono, { ...novo, name: "Hack Publicável" })).json();
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const ctx = { params: Promise.resolve({ id }) };

    // dono de outra comunidade não mexe na edição (IDOR)
    as(outroDono);
    expect((await PATCH(req("PATCH", { active: true }), ctx)).status).toBe(403);
    as(dono);
    const res = await PATCH(req("PATCH", { active: true }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.launch.notified).toBe(2); // dono + m1
    const notified = (
      await db.prepare("SELECT memberId FROM notifications WHERE type = 'edicao_nova' AND href = ? ORDER BY memberId").all<{ memberId: number }>(`/h/${id}`)
    ).map((r) => r.memberId);
    expect(notified).toEqual([dono.id, m1.id]);
    expect(notified).not.toContain(fora.id);
    expect(notified).not.toContain(outroDono.id);

    // arquivar é do admin
    expect((await PATCH(req("PATCH", { active: false }), ctx)).status).toBe(403);
    const admin = await member("admin");
    as(admin);
    expect((await PATCH(req("PATCH", { active: false }), ctx)).status).toBe(200);
    expect((await PATCH(req("PATCH", { active: true }), ctx)).status).toBe(200);
    // voltar pro ar não anuncia de novo
    expect(
      Number((await db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'edicao_nova' AND href = ?").get<{ n: number }>(`/h/${id}`))?.n),
    ).toBe(2);
  });

  it("checklist incompleto bloqueia a publicação do organizador (409)", async () => {
    const dono = await member();
    await community("ch-block", dono);
    const { id } = await (await createIn("ch-block", dono, { ...novo, name: "Hack Bloqueado" })).json();
    // tira o local: presencial sem local não publica
    await db.prepare("UPDATE hackathons SET location = NULL WHERE id = ?").run(id);
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    as(dono);
    const res = await PATCH(req("PATCH", { active: true }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(409);
    expect((await res.json()).missing.length).toBeGreaterThan(0);
  });

  it("organizador edita descrição e link do evento; link inválido é 400", async () => {
    const dono = await member();
    await community("ch-desc", dono);
    const { id } = await (await createIn("ch-desc", dono, { ...novo, name: "Hack Descrito" })).json();
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    as(dono);
    const ctx = { params: Promise.resolve({ id }) };
    expect((await PATCH(req("PATCH", { description: "Nova descrição", infoUrl: "https://hack.dev" }), ctx)).status).toBe(200);
    expect((await PATCH(req("PATCH", { infoUrl: "data:text/html,x" }), ctx)).status).toBe(400);
    expect(await db.prepare("SELECT description, infoUrl FROM hackathons WHERE id = ?").get(id)).toEqual({
      description: "Nova descrição",
      infoUrl: "https://hack.dev/",
    });
  });
});
