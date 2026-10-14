import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { BADGES } from "@/lib/game";
import { getHackathon } from "@/lib/hackathons";
import { isRegistrationClosed } from "@/lib/hackathons";
import { normalizeEventTime, parseEventTime, toBrtInput } from "@/lib/eventTime";
import { parseEventStart } from "@/lib/rsvp";
import { grantEditionRole, inviteToEdition, revokeEditionRole } from "@/lib/roles";
import { seedDatabase } from "@/lib/seed";

// Auditoria 041, pacote B: datas sempre no horário de Brasília, criar edição
// sem sobrescrever nada, seed que não aposenta edição do painel, organizador
// operando a própria edição (editar, publicar, aprovar) e jurado revogado
// perdendo as atribuições.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "pacote-b-edicao";
let seq = 0;

async function member(role = "member") {
  const tag = `pb${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id = H) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  as(null);
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl,
         registrationDeadline, tags, active, source)
       VALUES (?, 'Hack Pacote B', 'Hack Inova', '2026-11-28T09:00:00-03:00', '2026-11-29T18:00:00-03:00',
               'presencial', 'Unipe, Alphaville', '/h/pacote-b-edicao', '2026-11-20T23:59:00-03:00', '[]', 1, 'admin')
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = excluded.endsAt,
         registrationDeadline = excluded.registrationDeadline, active = 1, requiresApproval = 0,
         location = excluded.location, name = excluded.name`,
    )
    .run(H);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(H);
  await db.prepare("DELETE FROM edition_roles WHERE hackathonId = ?").run(H);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parser único de datas da edição", () => {
  it("sem fuso é Brasília; data pura é 09:00 BRT; com fuso é o instante", () => {
    expect(parseEventTime("2026-11-14T09:00")?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(parseEventStart("2026-11-14T09:00")?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(parseEventTime("2026-11-14")?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(parseEventTime("2026-11-14T09:00:00-03:00")?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(parseEventTime("2026-11-14 12:00:00")?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(parseEventTime("2026-13-40")).toBeNull();
    expect(parseEventTime("amanhã")).toBeNull();
    expect(normalizeEventTime("2026-11-14T09:00")).toBe("2026-11-14T09:00:00-03:00");
    expect(() => normalizeEventTime("14/11/2026")).toThrow();
    expect(toBrtInput("2026-11-14T09:00:00-03:00")).toBe("2026-11-14T09:00");
    expect(toBrtInput("2026-11-14T12:00:00Z")).toBe("2026-11-14T09:00");
  });

  it("to_ts no banco concorda com o parser do app", async () => {
    for (const v of [
      "2026-11-14T09:00",
      "2026-11-14T09:00:30",
      "2026-11-14",
      "2026-11-14T09:00:00-03:00",
      "2026-11-14T12:00:00Z",
      "2026-11-14 12:00:00",
    ]) {
      const row = await db.prepare("SELECT to_ts(?) AS t").get<{ t: Date | string }>(v);
      expect(new Date(row!.t).toISOString(), v).toBe(parseEventTime(v)!.toISOString());
    }
  });

  it("prazo de inscrição sem fuso fecha no horário de Brasília", () => {
    const h = { registrationDeadline: "2026-11-20T23:59" };
    expect(isRegistrationClosed(h, new Date("2026-11-21T02:58:00Z"))).toBe(false);
    expect(isRegistrationClosed(h, new Date("2026-11-21T03:00:00Z"))).toBe(true);
  });
});

describe("PATCH /api/admin/hackathons/[id]", () => {
  it("salvar o formulário sem mudar nada não altera as datas", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    as(await member("admin"));
    const before = (await getHackathon(H))!;
    // o que o EditEventForm manda: os inputs datetime-local preenchidos
    const res = await PATCH(
      req("PATCH", {
        name: before.name,
        startsAt: toBrtInput(before.startsAt),
        endsAt: toBrtInput(before.endsAt),
        registrationDeadline: toBrtInput(before.registrationDeadline),
        requiresApproval: true,
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const after = (await getHackathon(H))!;
    expect(after.startsAt).toBe("2026-11-28T09:00:00-03:00");
    expect(after.endsAt).toBe("2026-11-29T18:00:00-03:00");
    expect(after.registrationDeadline).toBe("2026-11-20T23:59:00-03:00");
    expect(after.requiresApproval).toBe(true);
  });

  it("data nova sem fuso é gravada com o offset de Brasília; formato desconhecido é 400", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    as(await member("admin"));
    expect((await PATCH(req("PATCH", { startsAt: "2026-11-28T10:00" }), ctx())).status).toBe(200);
    expect((await getHackathon(H))!.startsAt).toBe("2026-11-28T10:00:00-03:00");
    expect((await PATCH(req("PATCH", { startsAt: "28/11/2026" }), ctx())).status).toBe(400);
    expect((await PATCH(req("PATCH", { registrationUrl: "javascript:alert(1)" }), ctx())).status).toBe(400);
  });

  it("organizador da edição edita; staff não; só o admin arquiva", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const org = await member();
    const staff = await member();
    await grantEditionRole(H, org.id, "organizador", null);
    await grantEditionRole(H, staff.id, "staff", null);
    as(staff);
    expect((await PATCH(req("PATCH", { name: "Outro nome" }), ctx())).status).toBe(403);
    as(org);
    expect((await PATCH(req("PATCH", { location: "Sorocaba, SP", requiresApproval: true }), ctx())).status).toBe(200);
    expect((await getHackathon(H))!.location).toBe("Sorocaba, SP");
    expect((await PATCH(req("PATCH", { active: false }), ctx())).status).toBe(403);
    expect((await getHackathon(H))!.active).toBe(true);
    // link de inscrição só com o admin, mesmo https válido
    const link = (await getHackathon(H))!.registrationUrl;
    expect((await PATCH(req("PATCH", { registrationUrl: "https://fora.example/inscricao" }), ctx())).status).toBe(403);
    expect((await getHackathon(H))!.registrationUrl).toBe(link);
  });

  it("organizador publica o rascunho só com o mínimo pronto (início e local)", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const org = await member();
    await grantEditionRole(H, org.id, "organizador", null);
    await db.prepare("UPDATE hackathons SET active = 0, publishedAt = NULL, location = NULL WHERE id = ?").run(H);
    as(org);
    const blocked = await PATCH(req("PATCH", { active: true }), ctx());
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).missing).toEqual(["local do evento"]);
    expect((await getHackathon(H))!.active).toBe(false);
    await PATCH(req("PATCH", { location: "Unipe, Alphaville" }), ctx());
    expect((await PATCH(req("PATCH", { active: true }), ctx())).status).toBe(200);
    expect((await getHackathon(H))!.active).toBe(true);
    expect((await getHackathon(H))!.publishedAt).toBeTruthy();
  });

  it("edição arquivada pelo admin só volta pro ar pelo admin", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const { getEditionChecklist } = await import("@/lib/editionChecklist");
    const admin = await member("admin");
    const org = await member();
    await grantEditionRole(H, org.id, "organizador", null);
    as(admin);
    expect((await PATCH(req("PATCH", { active: false }), ctx())).status).toBe(200);
    const archived = (await getEditionChecklist(H, new Date("2026-11-01T12:00:00Z")))!;
    expect(archived.phase).toBe("arquivada");
    as(org);
    const res = await PATCH(req("PATCH", { active: true }), ctx());
    expect(res.status).toBe(403);
    expect((await getHackathon(H))!.active).toBe(false);
    as(admin);
    expect((await PATCH(req("PATCH", { active: true }), ctx())).status).toBe(200);
    expect((await getHackathon(H))!.active).toBe(true);
  });
});

describe("POST /api/admin/hackathons (nova edição)", () => {
  const novo = { id: "pacote-b-nova-2027", name: "Hack Nova", startsAt: "2027-03-10T09:00", location: "Sorocaba" };

  it("edição da casa nasce rascunho, com origem 'painel' e data no horário de Brasília", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/route");
    as(await member("admin"));
    await db.prepare("DELETE FROM hackathons WHERE id = ?").run(novo.id);
    const res = await POST(req("POST", novo));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: novo.id, radar: false });
    const row = await db
      .prepare("SELECT active, source, startsAt, organizer, registrationUrl FROM hackathons WHERE id = ?")
      .get(novo.id);
    expect(row).toEqual({
      active: 0,
      source: "painel",
      startsAt: "2027-03-10T09:00:00-03:00",
      organizer: "Hack Inova",
      registrationUrl: `/h/${novo.id}`,
    });
  });

  it("evento de terceiro vai direto pro radar com origem 'admin', link e prêmio", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/route");
    as(await member("admin"));
    const id = "pacote-b-terceiro-2027";
    await db.prepare("DELETE FROM hackathons WHERE id = ?").run(id);
    const res = await POST(
      req("POST", {
        ...novo,
        id,
        organizer: "Prefeitura de Sorocaba",
        registrationUrl: "https://www.sympla.com.br/evento/x",
        prize: "R$ 15 mil",
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id, radar: true });
    expect(
      await db.prepare("SELECT active, source, organizer, registrationUrl, prize FROM hackathons WHERE id = ?").get(id),
    ).toEqual({
      active: 1,
      source: "admin",
      organizer: "Prefeitura de Sorocaba",
      registrationUrl: "https://www.sympla.com.br/evento/x",
      prize: "R$ 15 mil",
    });
  });

  it("endereço já usado é 409 e a edição existente fica intacta", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/route");
    as(await member("admin"));
    const before = await db.prepare("SELECT * FROM hackathons WHERE id = ?").get(H);
    const res = await POST(req("POST", { id: H, name: "Nome sobrescrito", startsAt: "2026-01-01T09:00" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Já existe/);
    expect(await db.prepare("SELECT * FROM hackathons WHERE id = ?").get(H)).toEqual(before);
  });

  it("valida endereço, link e data; só admin global cria", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/route");
    as(await member());
    expect((await POST(req("POST", novo))).status).toBe(403);
    as(await member("admin"));
    expect((await POST(req("POST", { ...novo, id: "Com Espaço/x" }))).status).toBe(400);
    expect((await POST(req("POST", { ...novo, id: "ab" }))).status).toBe(400);
    expect((await POST(req("POST", { ...novo, id: "pb-link-ruim", registrationUrl: "javascript:alert(1)" }))).status).toBe(
      400,
    );
    expect((await POST(req("POST", { ...novo, id: "pb-data-ruim", startsAt: "ontem" }))).status).toBe(400);
  });

  it("seedDatabase depois de criar e publicar pelo painel mantém a edição no ar", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/route");
    as(await member("admin"));
    const id = "pacote-b-seed-2027";
    await db.prepare("DELETE FROM hackathons WHERE id = ?").run(id);
    expect((await POST(req("POST", { ...novo, id }))).status).toBe(201);
    await db.prepare("UPDATE hackathons SET active = 1 WHERE id = ?").run(id);
    await seedDatabase(db);
    expect((await getHackathon(id))!.active).toBe(true);
    // e linha de seed que saiu da lista continua sendo aposentada
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, active, source)
         VALUES ('pacote-b-seed-velho', 'Velho', 'Hack Inova', '2025-01-01', 'presencial', '/h/x', 1, 'seed')
         ON CONFLICT (id) DO UPDATE SET active = 1`,
      )
      .run();
    await seedDatabase(db);
    expect((await getHackathon("pacote-b-seed-velho"))!.active).toBe(false);
  });
});

describe("curadoria pelo organizador (PATCH registrations/[memberId])", () => {
  it("organizador não-admin aprova (200); staff não aprova (403)", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/registrations/[memberId]/route");
    const org = await member();
    const staff = await member();
    const p = await member();
    await grantEditionRole(H, org.id, "organizador", null);
    await grantEditionRole(H, staff.id, "staff", null);
    await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'pending')").run(p.id, H);
    const params = { params: Promise.resolve({ id: H, memberId: String(p.id) }) };
    as(staff);
    expect((await PATCH(req("PATCH", { action: "approve" }), params)).status).toBe(403);
    as(org);
    const ok = await PATCH(req("PATCH", { action: "approve" }), params);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.status).toBe("approved");
    // conquistas pelo nome legível (BADGES[id].name), não pelo id interno
    const names = new Set(Object.values(BADGES).map((b) => b.name));
    for (const b of body.newBadges ?? []) expect(names.has(b)).toBe(true);
    expect(
      await db.prepare("SELECT status FROM registrations WHERE memberId = ? AND hackathonId = ?").get(p.id, H),
    ).toEqual({ status: "approved" });
  });
});

describe("equipe da edição", () => {
  it("revogar jurado apaga as atribuições dele na mesma operação", async () => {
    const judge = await member();
    const other = await member();
    await grantEditionRole(H, judge.id, "jurado", null);
    await grantEditionRole(H, other.id, "jurado", null);
    const team = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Time B') RETURNING id")
      .get<{ id: number }>(H);
    await db
      .prepare("INSERT INTO judge_assignments (hackathonId, judgeMemberId, teamId) VALUES (?, ?, ?), (?, ?, ?)")
      .run(H, judge.id, team!.id, H, other.id, team!.id);
    await revokeEditionRole(H, judge.id, "jurado");
    const left = await db
      .prepare("SELECT judgeMemberId FROM judge_assignments WHERE hackathonId = ? ORDER BY judgeMemberId")
      .all(H);
    expect(left).toEqual([{ judgeMemberId: other.id }]);
    // tirar outro papel não mexe nas atribuições
    await grantEditionRole(H, other.id, "staff", null);
    await revokeEditionRole(H, other.id, "staff");
    expect(await db.prepare("SELECT COUNT(*)::int AS n FROM judge_assignments WHERE hackathonId = ?").get(H)).toEqual({
      n: 1,
    });
  });

  it("quem ganha papel recebe aviso no site com o link da aba do papel", async () => {
    const org = await member();
    const p = await member();
    const email = (await db.prepare("SELECT email FROM members WHERE id = ?").get<{ email: string }>(p.id))!.email;
    expect(await inviteToEdition(H, email, "staff", org.id)).toBe("granted");
    const n = await db
      .prepare("SELECT type, href, text FROM notifications WHERE memberId = ? ORDER BY id DESC LIMIT 1")
      .get<{ type: string; href: string; text: string }>(p.id);
    expect(n).toMatchObject({ type: "edition_role", href: `/admin/h/${H}/checkin` });
    expect(n!.text).toContain("Hack Pacote B");
    // convite repetido não duplica o aviso
    await inviteToEdition(H, email, "staff", org.id);
    expect(
      await db.prepare("SELECT COUNT(*)::int AS n FROM notifications WHERE memberId = ? AND type = 'edition_role'").get(p.id),
    ).toEqual({ n: 1 });
  });

  it("convite pra quem não tem conta sai por e-mail quando o e-mail está ligado", async () => {
    const sent: string[] = [];
    vi.stubEnv("RESEND_API_KEY", "re_teste");
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    });
    expect(await inviteToEdition(H, "novato-pb@t.dev", "mentor", null)).toBe("pending");
    vi.unstubAllGlobals();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("novato-pb@t.dev");
    expect(sent[0]).toContain(`/admin/h/${H}/duvidas`);
  });
});

describe("visão geral: fase e checklist", () => {
  it("rascunho → inscrições → dia do evento → encerrada", async () => {
    const { editionPhase } = await import("@/lib/editionChecklist");
    const h = { active: 1, startsAt: "2026-11-28T09:00", endsAt: "2026-11-29T18:00", registrationDeadline: "2026-11-20" };
    expect(editionPhase({ ...h, active: 0 }, new Date("2026-11-01T12:00:00Z"))).toBe("rascunho");
    expect(editionPhase({ ...h, active: 0, publishedAt: "2026-10-01 12:00:00" }, new Date("2026-11-01T12:00:00Z"))).toBe(
      "arquivada",
    );
    expect(editionPhase(h, new Date("2026-11-01T12:00:00Z"))).toBe("inscricoes");
    expect(editionPhase(h, new Date("2026-11-22T12:00:00Z"))).toBe("inscricoes_encerradas");
    expect(editionPhase(h, new Date("2026-11-28T10:00:00Z"))).toBe("dia_do_evento");
    expect(editionPhase(h, new Date("2026-12-02T12:00:00Z"))).toBe("encerrada");
  });

  it("checklist aponta o que falta, com link pra aba que resolve", async () => {
    const { getEditionChecklist } = await import("@/lib/editionChecklist");
    await db.prepare("UPDATE hackathons SET active = 0, publishedAt = NULL, capacity = NULL WHERE id = ?").run(H);
    const c = (await getEditionChecklist(H, new Date("2026-11-01T12:00:00Z")))!;
    expect(c.phase).toBe("rascunho");
    expect(c.blockers).toEqual([]);
    const vagas = c.items.find((i) => i.key === "vagas")!;
    expect(vagas).toMatchObject({ done: false, href: `/admin/h/${H}/edicao` });
    expect(c.items.find((i) => i.key === "datas")!.done).toBe(true);
    expect(c.items.find((i) => i.key === "prazo")!.done).toBe(true);
  });
});
