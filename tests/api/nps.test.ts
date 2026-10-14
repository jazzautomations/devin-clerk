import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";
import { addEditionSponsor, inviteSponsorPerson } from "@/lib/editionSponsors";
import { eligibleMembers, getNpsSummary, runNpsDispatch, submitNps } from "@/lib/nps";
import { getSponsorReport } from "@/lib/sponsorReport";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";

// Frente O (migration 017) — NPS por papel só pra presentes: quem recebe,
// uma resposta por pessoa, anonimato no painel, prazo, disparo idempotente
// pelo cron de entregas e guardas 401/403/400/409.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "nps-api";
const FUTURE = "nps-futura";
let seq = 0;
type M = { id: number; clerkId: string; email: string };
async function member(opts: { status?: string; checkin?: boolean; edition?: string; edition2?: string } = {}) {
  const tag = `nps${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, name, email) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `Nome ${tag}`, `${tag}@t.dev`);
  if (opts.status) {
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(row!.id, H, opts.status);
    if (opts.checkin) await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
  }
  for (const e of [opts.edition, opts.edition2]) if (e) await grantEditionRole(H, row!.id, e as "organizador", null);
  return { id: row!.id, clerkId: `clerk_${tag}`, email: `${tag}@t.dev` } as M;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id = H) => ({ params: Promise.resolve({ id }) });
const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

let org: M, present: M, absent: M, pending: M, mentor: M, jurorAlsoPresent: M, staff: M, sponsorPerson: M, outsider: M;
let sponsorId: string;

beforeAll(async () => {
  // edição terminou há 2h; a outra ainda nem começou
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl)
       VALUES (?, 'NPS Jam', 'Hack Inova', ?, ?, 'presencial', 'https://x.dev')`,
    )
    .run(H, sql(hoursAgo(30)), sql(hoursAgo(2)));
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl)
       VALUES (?, 'NPS Futura', 'Hack Inova', ?, ?, 'presencial', 'https://x.dev')`,
    )
    .run(FUTURE, sql(new Date(Date.now() + 86_400_000 * 5)), sql(new Date(Date.now() + 86_400_000 * 6)));
  org = await member({ edition: "organizador" });
  present = await member({ status: "approved", checkin: true });
  absent = await member({ status: "approved" });
  pending = await member({ status: "pending" });
  mentor = await member({ edition: "mentor" });
  jurorAlsoPresent = await member({ status: "approved", checkin: true, edition: "jurado" });
  staff = await member({ edition: "staff" });
  sponsorPerson = await member();
  outsider = await member();
  sponsorId = (await addEditionSponsor(H, { name: "Marca NPS" }, org.id)).sponsorId;
  await inviteSponsorPerson(H, sponsorId, sponsorPerson.email, org.id);
});
beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => {
  as(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("quem recebe a pesquisa", () => {
  it("só presente (check-in) e papel; organizador, ausente e pendente ficam fora; papel mais de dentro ganha", async () => {
    const e = await eligibleMembers(H);
    expect(e.get(present.id)).toBe("participante");
    expect(e.get(mentor.id)).toBe("mentor");
    expect(e.get(staff.id)).toBe("staff");
    expect(e.get(sponsorPerson.id)).toBe("patrocinador");
    expect(e.get(jurorAlsoPresent.id)).toBe("jurado");
    for (const m of [org, absent, pending, outsider]) expect(e.has(m.id)).toBe(false);
  });
});

describe("disparo idempotente pelo cron de entregas", () => {
  it("edição que ainda não terminou não dispara; a encerrada convida uma vez só, com aviso system", async () => {
    const first = await runNpsDispatch();
    expect(first.invited).toBe(5);
    const again = await runNpsDispatch();
    expect(again.invited).toBe(0);
    const inv = await db.prepare("SELECT memberId, role, announcementId FROM nps_invites WHERE hackathonId = ?").all<{
      memberId: number;
      role: string;
      announcementId: number;
    }>(H);
    expect(inv).toHaveLength(5);
    expect(await db.prepare("SELECT 1 FROM nps_invites WHERE hackathonId = ?").all(FUTURE)).toEqual([]);
    const ann = await db
      .prepare("SELECT audience, system, body FROM announcements WHERE id = ?")
      .get<{ audience: string; system: number; body: string }>(inv[0].announcementId);
    expect(ann).toMatchObject({ audience: "lista", system: 1 });
    expect(ann!.body).toContain(`/h/${H}/nps`);
    // entrega in-app + e-mail pra cada convidado, uma vez
    const d = await db
      .prepare("SELECT channel, COUNT(*)::int AS n FROM deliveries WHERE announcementId = ? GROUP BY channel ORDER BY channel")
      .all(inv[0].announcementId);
    expect(d).toEqual([
      { channel: "email", n: 5 },
      { channel: "inapp", n: 5 },
    ]);
    // quem ganha papel depois entra no próximo disparo — e só ele
    const late = await member({ edition: "staff" });
    const third = await runNpsDispatch();
    expect(third.invited).toBe(1);
    expect(await db.prepare("SELECT role FROM nps_invites WHERE memberId = ?").get(late.id)).toEqual({ role: "staff" });
  });

  it("POST /api/cron/deliveries: 401 sem bearer; com bearer roda o NPS junto e não duplica", async () => {
    const { POST } = await import("@/app/api/cron/deliveries/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "cron-nps");
    expect((await POST(req("POST"))).status).toBe(401);
    expect((await POST(req("POST", undefined, { Authorization: "Bearer errado" }))).status).toBe(401);
    const res = await POST(req("POST", undefined, { Authorization: "Bearer cron-nps" }));
    expect(res.status).toBe(200);
    expect((await res.json()).nps).toMatchObject({ invited: 0 });
  });
});

describe("responder", () => {
  it("401 anon; 403 sem presença/papel (ausente, organizador); 400 nota inválida; 200 grava", async () => {
    const { GET, PUT } = await import("@/app/api/hackathons/[id]/nps/route");
    const r = await PUT(req("PUT", { score: 9 }), ctx());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
    expect((await GET(req("GET"), ctx())).status).toBe(401);
    as(absent);
    expect((await PUT(req("PUT", { score: 9 }), ctx())).status).toBe(403);
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    as(org);
    expect((await PUT(req("PUT", { score: 9 }), ctx())).status).toBe(403);
    as(present);
    expect((await PUT(req("PUT", { score: 11 }), ctx())).status).toBe(400);
    expect((await PUT(req("PUT", "{"), ctx())).status).toBe(400);
    expect((await GET(req("GET"), ctx("nao-existe"))).status).toBe(404);
    const got = await (await GET(req("GET"), ctx())).json();
    expect(got).toMatchObject({ role: "participante", phase: "aberta", answer: null });
    expect(got.questions.score).toMatch(/0 a 10/);
    const ok = await PUT(req("PUT", { score: 9, worked: "mentoria", improve: "wi-fi" }), ctx());
    expect(ok.status).toBe(200);
    expect((await ok.json()).answer).toMatchObject({ role: "participante", score: 9, worked: "mentoria" });
  });

  it("uma resposta por pessoa: responder de novo edita, não duplica", async () => {
    await submitNps(H, present.id, { score: 4, improve: "comida" });
    const rows = await db.prepare("SELECT score, improve FROM nps_responses WHERE hackathonId = ? AND memberId = ?").all(H, present.id);
    expect(rows).toEqual([{ score: 4, improve: "comida" }]);
  });

  it("409 antes da edição terminar e depois do prazo", async () => {
    const early = await member();
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .run(early.id, FUTURE);
    await grantEditionRole(FUTURE, early.id, "mentor", null);
    await expect(submitNps(FUTURE, early.id, { score: 8 })).rejects.toMatchObject({ status: 409 });
    // prazo do organizador no passado → fechada
    await db.prepare("UPDATE hackathons SET npsClosesAt = ? WHERE id = ?").run(sql(hoursAgo(1)), H);
    await expect(submitNps(H, mentor.id, { score: 8 })).rejects.toMatchObject({ status: 409 });
    const { PUT } = await import("@/app/api/hackathons/[id]/nps/route");
    as(mentor);
    expect((await PUT(req("PUT", { score: 8 }), ctx())).status).toBe(409);
    // fechada, o cron não convida mais ninguém
    await member({ edition: "staff" });
    expect((await runNpsDispatch()).invited).toBe(0);
    await db.prepare("UPDATE hackathons SET npsClosesAt = NULL WHERE id = ?").run(H);
  });
});

describe("painel do organizador — anônimo", () => {
  it("401/403; agrega por papel sem memberId nem data; papel pequeno sem rótulo", async () => {
    await submitNps(H, mentor.id, { score: 10, worked: "times bons" });
    await submitNps(H, staff.id, { score: 6 });
    await submitNps(H, jurorAlsoPresent.id, { score: 7, improve: "rubrica longa" });
    const { GET, PUT } = await import("@/app/api/admin/hackathons/[id]/nps/route");
    expect((await GET(req("GET"), ctx())).status).toBe(401);
    as(present);
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    as(staff);
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    as(org);
    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.overall.responses).toBe(4);
    const text = JSON.stringify(body.summary);
    expect(text).not.toMatch(/memberId|createdAt|updatedAt|@t\.dev|Nome nps/);
    // cada papel tem 1 resposta (< 3): nota do papel escondida, comentário sem rótulo
    for (const g of body.summary.byRole) expect(g.stats).toBeNull();
    expect(body.summary.comments.every((c: { role: string | null }) => c.role === null)).toBe(true);
    expect(body.window.phase).toBe("aberta");

    // prazo: 400 antes do fim da edição / formato ruim; 200 válido; null volta pro padrão
    expect((await PUT(req("PUT", {}), ctx())).status).toBe(400);
    expect((await PUT(req("PUT", { closesAt: "amanhã" }), ctx())).status).toBe(400);
    expect((await PUT(req("PUT", { closesAt: "2020-01-01T10:00" }), ctx())).status).toBe(400);
    const future = new Date(Date.now() + 3 * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 16);
    const put = await PUT(req("PUT", { closesAt: future }), ctx());
    expect(put.status).toBe(200);
    expect((await put.json()).window.custom).toBe(true);
    expect((await (await PUT(req("PUT", { closesAt: null }), ctx())).json()).window.custom).toBe(false);
  });

  it("o NPS agregado (sem comentário) entra no relatório do patrocinador", async () => {
    const r = (await getSponsorReport(H, sponsorId, { manager: false }))!;
    expect(r.nps.overall.responses).toBe(4);
    expect(r.nps).not.toHaveProperty("comments");
    expect(JSON.stringify(r.nps)).not.toContain("rubrica longa");
  });

  it("exportar meus dados traz a minha resposta; excluir a conta apaga", async () => {
    const exp = await exportMemberData(staff.id);
    expect(exp!.data["nps_responses.memberId"]).toEqual([expect.objectContaining({ hackathonId: H, score: 6 })]);
    await deleteMemberData(staff.id);
    expect(await db.prepare("SELECT 1 FROM nps_responses WHERE memberId = ?").all(staff.id)).toEqual([]);
    expect((await getNpsSummary(H)).overall.responses).toBe(3);
  });
});
