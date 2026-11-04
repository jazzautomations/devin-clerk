import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { ticketToken } from "@/lib/checkins";
import { buildOfflinePack, syncCheckins, tokenHash, verifyOfflinePack } from "@/lib/checkinPack";
import { badgesPdf, listBadges, PER_SHEET } from "@/lib/crachas";
import { register, reviewRegistration, setEditionCapacity, unregister } from "@/lib/registrations";
import { grantEditionRole } from "@/lib/roles";
import { resetRateLimits } from "@/lib/ratelimit";
import { processTicketEmails, requeueTicketEmail, TICKET_QR_CID } from "@/lib/ticketEmail";
import { walkIn } from "@/lib/walkin";

// Dia do evento à prova de Wi-Fi ruim (roadmap 037 Onda 1 #5): QR no e-mail
// de aprovação, check-in offline com sync em lote, walk-in, crachás em PDF.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => null),
}));

type AuthResult = Awaited<ReturnType<typeof auth>>;
const asUser = (id: string | null) => vi.mocked(auth).mockResolvedValue({ userId: id } as AuthResult);

const H = "hack-inova-alphaville-2026";
const OTHER = "hack-inova-unifacens-2026";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, url = "http://t/") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function idOf(clerkId: string) {
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerkId))!.id;
}

async function reg(clerkId: string, status: string, hackathonId = H) {
  const memberId = await idOf(clerkId);
  await db
    .prepare(
      `INSERT INTO registrations (memberId, hackathonId, status, waitlistedAt)
       VALUES (?, ?, ?, CASE WHEN ?::text = 'waitlist' THEN datetime('now') END)`,
    )
    .run(memberId, hackathonId, status, status);
  return (await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(memberId, hackathonId))!.id;
}

const PEOPLE = [
  ["clerk_org", "org_h", "Olga Organiza"],
  ["clerk_staff", "staff_h", "Sergio Staff"],
  ["clerk_mentor", "mentor_h", "Marta Mentora"],
  ["clerk_a", "ana_h", "Ana Álvares"],
  ["clerk_b", "bia_h", "Beatriz Souza"],
  ["clerk_c", "caio_h", "Caio Prado"],
  ["clerk_d", "duda_h", "Duda Lima"],
] as const;

beforeEach(async () => {
  resetRateLimits();
  for (const [c, u, n] of PEOPLE) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
      .run(c, u, `${u}@segredo.dev`, n);
  }
  await db.prepare("DELETE FROM ticket_emails").run();
  await db.prepare("DELETE FROM checkins").run();
  await db.prepare("DELETE FROM registrations").run();
  await db.prepare("DELETE FROM edition_roles").run();
  await db
    .prepare("UPDATE hackathons SET capacity = NULL, requiresApproval = 0, startsAt = ?, endsAt = ? WHERE id = ?")
    .run("2026-11-07", "2026-11-08", H);
  await grantEditionRole(H, await idOf("clerk_org"), "organizador", null);
  await grantEditionRole(H, await idOf("clerk_staff"), "staff", null);
  await grantEditionRole(H, await idOf("clerk_mentor"), "mentor", null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- pacote

describe("pacote offline", () => {
  it("tem hash do token + nome + status; não vaza token, segredo HMAC nem e-mail", async () => {
    const ra = await reg("clerk_a", "approved");
    await reg("clerk_b", "waitlist");
    const pack = await buildOfflinePack({ id: H, startsAt: "2026-11-07", endsAt: "2026-11-08" });
    const raw = JSON.stringify(pack);
    expect(pack.entries).toHaveLength(2);
    const ana = pack.entries.find((e) => e.rid === ra)!;
    expect(ana).toMatchObject({ name: "Ana Álvares", username: "ana_h", status: "approved", at: null });
    expect(ana.h).toBe(tokenHash(ticketToken(ra)));
    expect(raw).not.toContain(ticketToken(ra));
    expect(raw).not.toContain(ticketToken(ra).slice(4, 20));
    expect(raw).not.toContain("@segredo.dev");
    expect(raw).not.toContain("hackahub-dev-ticket-secret");
    expect(Object.keys(ana).sort()).toEqual(["at", "h", "name", "rid", "status", "username"]);
  });

  it("assinatura confere e quebra se alguém mexer no pacote", async () => {
    await reg("clerk_a", "waitlist");
    const pack = await buildOfflinePack({ id: H, startsAt: "2026-11-07", endsAt: null });
    expect(verifyOfflinePack(pack)).toBe(true);
    const forged = { ...pack, entries: pack.entries.map((e) => ({ ...e, status: "approved" as const })) };
    expect(verifyOfflinePack(forged)).toBe(false);
  });

  it("GET …/checkin/pack: 401 anon, 403 mentor, 404 edição fantasma, 200 staff (no-store)", async () => {
    const { GET } = await import("@/app/api/admin/hackathons/[id]/checkin/pack/route");
    asUser(null);
    expect((await GET(req("GET"), params(H))).status).toBe(401);
    asUser("clerk_mentor");
    expect((await GET(req("GET"), params(H))).status).toBe(403);
    asUser("clerk_staff");
    expect((await GET(req("GET"), params(OTHER))).status).toBe(403);
    expect((await GET(req("GET"), params("fantasma"))).status).toBe(404);
    await reg("clerk_a", "approved");
    const ok = await GET(req("GET"), params(H));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(body.entries).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("@segredo.dev");
  });

  it("rate limit: 61º download do pacote na hora → 429 com Retry-After", async () => {
    const { GET } = await import("@/app/api/admin/hackathons/[id]/checkin/pack/route");
    asUser("clerk_staff");
    for (let i = 0; i < 60; i++) expect((await GET(req("GET"), params(H))).status).toBe(200);
    const limited = await GET(req("GET"), params(H));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- sync

describe("sync em lote", () => {
  const ed = { id: H, startsAt: "2026-11-07", endsAt: "2026-11-08" };
  const now = new Date("2026-11-07T20:00:00Z");

  it("idempotente: mandar a mesma fila duas vezes não duplica nada", async () => {
    const ra = await reg("clerk_a", "approved");
    const staff = await idOf("clerk_staff");
    const items = [{ token: ticketToken(ra), at: "2026-11-07T14:00:00.000Z" }];
    const first = await syncCheckins(ed, items, staff, now);
    expect(first).toEqual([{ rid: ra, ok: true, outcome: "created", at: "2026-11-07 14:00:00" }]);
    const again = await syncCheckins(ed, items, staff, now);
    expect(again).toEqual([{ rid: ra, ok: true, outcome: "already", at: "2026-11-07 14:00:00" }]);
    const rows = await db.prepare("SELECT at, via, byMemberId FROM checkins").all();
    expect(rows).toEqual([{ at: "2026-11-07 14:00:00", via: "offline", byMemberId: staff }]);
  });

  it("conflito entre aparelhos: vale o primeiro horário, chegue em que ordem chegar", async () => {
    const ra = await reg("clerk_a", "approved");
    const rb = await reg("clerk_b", "approved");
    // A: aparelho atrasado sincroniza depois com horário mais cedo
    await syncCheckins(ed, [{ token: ticketToken(ra), at: "2026-11-07T15:00:00Z" }], null, now);
    const r = await syncCheckins(ed, [{ registrationId: ra, at: "2026-11-07T14:10:00Z" }], null, now);
    expect(r[0]).toMatchObject({ ok: true, outcome: "earlier", at: "2026-11-07 14:10:00" });
    // B: o mais tarde chegando depois não mexe
    await syncCheckins(ed, [{ token: ticketToken(rb), at: "2026-11-07T14:00:00Z" }], null, now);
    const r2 = await syncCheckins(ed, [{ token: ticketToken(rb), at: "2026-11-07T16:00:00Z" }], null, now);
    expect(r2[0]).toMatchObject({ outcome: "already", at: "2026-11-07 14:00:00" });
  });

  it("check-in online feito antes conta: offline mais tarde vira already", async () => {
    const ra = await reg("clerk_a", "approved");
    await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, '2026-11-07 13:00:00')").run(ra);
    const r = await syncCheckins(ed, [{ token: ticketToken(ra), at: "2026-11-07T13:30:00Z" }], null, now);
    expect(r[0]).toMatchObject({ outcome: "already", at: "2026-11-07 13:00:00" });
  });

  it("horário do aparelho é limitado à janela da edição e a agora", async () => {
    const ra = await reg("clerk_a", "approved");
    const rb = await reg("clerk_b", "approved");
    const [a, b] = await syncCheckins(
      ed,
      [
        { token: ticketToken(ra), at: "1999-01-01T00:00:00Z" },
        { token: ticketToken(rb), at: "2099-01-01T00:00:00Z" },
      ],
      null,
      now,
    );
    // a janela começa na véspera às 09:00 de Brasília (data pura = 09:00 BRT);
    // os dois horários foram ajustados e vêm marcados
    expect(a).toMatchObject({ ok: true, at: "2026-11-06 12:00:00", clamped: true });
    expect(b).toMatchObject({ ok: true, at: "2026-11-07 20:00:00", clamped: true });
  });

  it("fora da janela do evento o sync não grava nada (antes e depois)", async () => {
    const ra = await reg("clerk_a", "approved");
    const item = [{ token: ticketToken(ra), at: "2026-11-07T14:00:00Z" }];
    const antes = new Date(new Date("2026-11-07T12:00:00Z").getTime() - 10 * 86_400_000);
    expect(await syncCheckins(ed, item, null, antes)).toEqual([{ rid: ra, ok: false, reason: "outside_window" }]);
    // fim 08/11 09:00 BRT + 48h = 10/11 12:00Z; um minuto depois já fecha
    const depois = new Date("2026-11-10T12:01:00Z");
    expect(await syncCheckins(ed, item, null, depois)).toEqual([{ rid: ra, ok: false, reason: "outside_window" }]);
    expect(await db.prepare("SELECT * FROM checkins").all()).toHaveLength(0);
  });

  it("recusa: status mudou, ingresso de outra edição, lixo — e não grava nada", async () => {
    const rw = await reg("clerk_a", "waitlist");
    const ro = await reg("clerk_b", "approved", OTHER);
    const r = await syncCheckins(
      ed,
      [{ token: ticketToken(rw) }, { token: ticketToken(ro) }, { token: "nada" }, { registrationId: 999999 }],
      null,
      now,
    );
    expect(r).toEqual([
      { rid: rw, ok: false, reason: "waitlist" },
      { rid: null, ok: false, reason: "not_found" },
      { rid: null, ok: false, reason: "invalid" },
      { rid: 999999, ok: false, reason: "not_found" },
    ]);
    expect(await db.prepare("SELECT * FROM checkins").all()).toHaveLength(0);
  });

  it("POST …/checkin/sync: 401/403/400 e 200 com resultados + contador", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/checkin/sync/route");
    const ra = await reg("clerk_a", "approved");
    asUser(null);
    expect((await POST(req("POST", { items: [] }), params(H))).status).toBe(401);
    asUser("clerk_a");
    expect((await POST(req("POST", { items: [{ token: ticketToken(ra) }] }), params(H))).status).toBe(403);
    asUser("clerk_staff");
    expect((await POST(req("POST", { items: [] }), params(H))).status).toBe(400);
    expect((await POST(req("POST", { items: Array(501).fill({}) }), params(H))).status).toBe(400);
    // a edição acontece hoje: o sync só grava dentro da janela do evento
    const today = new Date().toISOString();
    await db.prepare("UPDATE hackathons SET startsAt = ?, endsAt = ? WHERE id = ?").run(today, today, H);
    const ok = await POST(req("POST", { items: [{ token: ticketToken(ra), at: new Date().toISOString() }] }), params(H));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.results[0]).toMatchObject({ rid: ra, ok: true });
    expect(body.counts.presentes).toBe(1);
  });
});

// ---------------------------------------------------------------- walk-in

describe("walk-in", () => {
  // walk-in só no dia do evento: a edição acontece hoje nesses testes
  beforeEach(async () => {
    const today = new Date().toISOString();
    await db.prepare("UPDATE hackathons SET startsAt = ?, endsAt = ? WHERE id = ?").run(today, today, H);
  });

  it("aprova + check-in quem está na fila, com recompensa e e-mail na fila", async () => {
    const rw = await reg("clerk_a", "waitlist");
    const r = await walkIn(H, rw, await idOf("clerk_staff"));
    expect(r).toMatchObject({ ok: true, registrationId: rw, username: "ana_h" });
    const row = await db
      .prepare("SELECT r.status, c.via FROM registrations r JOIN checkins c ON c.registrationId = r.id WHERE r.id = ?")
      .get(rw);
    expect(row).toEqual({ status: "approved", via: "walkin" });
    expect(await db.prepare("SELECT status FROM ticket_emails WHERE registrationId = ?").get(rw)).toEqual({
      status: "queued",
    });
    // a recompensa é a carta (XP por inscrição acabou, spec 046)
    const card = await db
      .prepare("SELECT mc.serial FROM member_cards mc JOIN members m ON m.id = mc.memberId WHERE m.clerkId = 'clerk_a' AND mc.hackathonId = ?")
      .get<{ serial: number }>(H);
    expect(card!.serial).toBeGreaterThan(0);
  });

  it("respeita a capacidade da sala: presentes >= capacidade → full", async () => {
    const r1 = await reg("clerk_a", "approved");
    const r2 = await reg("clerk_b", "approved");
    const rw = await reg("clerk_c", "waitlist");
    await db.prepare("UPDATE hackathons SET capacity = 2 WHERE id = ?").run(H);
    // os 2 aprovados estão na sala: não sobra cadeira
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?), (?)").run(r1, r2);
    expect(await walkIn(H, rw, null)).toMatchObject({ ok: false, reason: "full", capacity: 2, present: 2 });
    expect(await db.prepare("SELECT status FROM registrations WHERE id = ?").get(rw)).toEqual({ status: "waitlist" });
  });

  it("com no-show (presentes < capacidade) o walk-in entra mesmo com aprovados = capacidade", async () => {
    const r1 = await reg("clerk_a", "approved");
    await reg("clerk_b", "approved");
    const rw = await reg("clerk_c", "waitlist");
    await db.prepare("UPDATE hackathons SET capacity = 2 WHERE id = ?").run(H);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r1);
    expect(await walkIn(H, rw, null)).toMatchObject({ ok: true });
    // segundo walk-in: agora 2 presentes de 2
    const rd = await reg("clerk_d", "waitlist");
    expect(await walkIn(H, rd, null)).toMatchObject({ ok: false, reason: "full" });
  });

  it("recusado não entra; aprovado não é walk-in; outra edição é not_found", async () => {
    const rr = await reg("clerk_a", "rejected");
    const ra = await reg("clerk_b", "approved");
    const ro = await reg("clerk_c", "waitlist", OTHER);
    expect(await walkIn(H, rr, null)).toMatchObject({ ok: false, reason: "rejected" });
    expect(await walkIn(H, ra, null)).toMatchObject({ ok: false, reason: "already_approved" });
    expect(await walkIn(H, ro, null)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("pedido pendente não entra pela porta: quem decide é o organizador (409)", async () => {
    const rp = await reg("clerk_a", "pending");
    expect(await walkIn(H, rp, await idOf("clerk_staff"))).toMatchObject({ ok: false, reason: "pending" });
    expect(await db.prepare("SELECT status FROM registrations WHERE id = ?").get(rp)).toEqual({ status: "pending" });
    const { POST } = await import("@/app/api/admin/hackathons/[id]/checkin/walkin/route");
    asUser("clerk_staff");
    const res = await POST(req("POST", { registrationId: rp }), params(H));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/inscritos/);
    // e a lista da porta só mostra a fila de espera
    const { GET } = await import("@/app/api/admin/hackathons/[id]/checkin/walkin/route");
    expect((await (await GET(req("GET"), params(H))).json()).results).toEqual([]);
  });

  it("fora da janela do evento (véspera até 2 dias depois do fim) é 409", async () => {
    const rw = await reg("clerk_a", "waitlist");
    await db.prepare("UPDATE hackathons SET startsAt = '2026-11-07', endsAt = '2026-11-08' WHERE id = ?").run(H);
    expect(await walkIn(H, rw, null, new Date("2026-11-01T12:00:00Z"))).toMatchObject({
      ok: false,
      reason: "outside_window",
    });
    expect(await walkIn(H, rw, null, new Date("2026-11-11T12:00:00Z"))).toMatchObject({
      ok: false,
      reason: "outside_window",
    });
    expect(await db.prepare("SELECT status FROM registrations WHERE id = ?").get(rw)).toEqual({ status: "waitlist" });
    expect(await walkIn(H, rw, null, new Date("2026-11-07T13:00:00Z"))).toMatchObject({ ok: true });
  });

  it("API walk-in: 401/403; GET lista a fila sem e-mail; POST 200 e 409 sala cheia", async () => {
    const { GET, POST } = await import("@/app/api/admin/hackathons/[id]/checkin/walkin/route");
    const rw = await reg("clerk_a", "waitlist");
    const rw2 = await reg("clerk_b", "waitlist");
    asUser(null);
    expect((await GET(req("GET"), params(H))).status).toBe(401);
    expect((await POST(req("POST", { registrationId: rw }), params(H))).status).toBe(401);
    asUser("clerk_mentor");
    expect((await POST(req("POST", { registrationId: rw }), params(H))).status).toBe(403);
    asUser("clerk_staff");
    const list = await GET(req("GET", undefined, "http://t/?q=ana"), params(H));
    const lj = await list.json();
    expect(lj.results).toEqual([expect.objectContaining({ registrationId: rw, username: "ana_h", status: "waitlist" })]);
    expect(JSON.stringify(lj)).not.toContain("@segredo.dev");
    const ok = await POST(req("POST", { registrationId: rw }), params(H));
    expect(ok.status).toBe(200);
    expect((await ok.json()).message).toMatch(/fila de espera/i);
    await db.prepare("UPDATE hackathons SET capacity = 1 WHERE id = ?").run(H);
    expect((await POST(req("POST", { registrationId: rw2 }), params(H))).status).toBe(409);
  });
});

// ---------------------------------------------------------------- e-mail

describe("e-mail de aprovação com QR", () => {
  type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  function stubResend() {
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
        return new Response("{}", { status: 200 });
      }),
    );
    return sent;
  }
  const env = { RESEND_API_KEY: "re_teste" };

  it("toda transição pra aprovado enfileira (direta, aprovação, promoção da fila) — uma vez só", async () => {
    const a = await idOf("clerk_a");
    const b = await idOf("clerk_b");
    const c = await idOf("clerk_c");
    await setEditionCapacity(H, 1);
    await register(a, H); // aprovado na hora
    await register(b, H); // fila
    await db.prepare("UPDATE hackathons SET requiresApproval = 1 WHERE id = ?").run(H);
    await register(c, H); // pendente
    const queued = async () =>
      (await db.prepare("SELECT registrationId FROM ticket_emails ORDER BY registrationId").all()).length;
    expect(await queued()).toBe(1);
    await unregister(a, H); // b sobe da fila
    expect(await queued()).toBe(1); // a saiu (CASCADE), b entrou
    await setEditionCapacity(H, null);
    await reviewRegistration(c, H, "approve");
    await reviewRegistration(c, H, "approve"); // re-approve: no-op
    expect(await queued()).toBe(2);
  });

  it("worker manda 1 e-mail com o QR inline (cid) e link do ingresso; rodar de novo não reenvia", async () => {
    const sent = stubResend();
    await register(await idOf("clerk_a"), H);
    const r1 = await processTicketEmails(50, { env });
    expect(r1).toMatchObject({ processed: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    const { body, headers } = sent[0];
    expect(body.to).toEqual(["ana_h@segredo.dev"]);
    expect(String(body.html)).toContain(`cid:${TICKET_QR_CID}`);
    expect(String(body.html)).toContain(`/h/${H}/ingresso`);
    const att = (body.attachments as Record<string, string>[])[0];
    expect(att).toMatchObject({ filename: "ingresso-qr.png", content_type: "image/png", content_id: TICKET_QR_CID });
    expect(Buffer.from(att.content, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(headers["Idempotency-Key"]).toMatch(/^ticket-\d+-1$/);

    expect(await processTicketEmails(50, { env })).toMatchObject({ processed: 0 });
    await reviewRegistration(await idOf("clerk_a"), H, "approve");
    expect(await processTicketEmails(50, { env })).toMatchObject({ processed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("sem RESEND_API_KEY: skipped, nenhuma chamada de rede", async () => {
    const sent = stubResend();
    await register(await idOf("clerk_a"), H);
    expect(await processTicketEmails(50, { env: {} })).toMatchObject({ processed: 1, skipped: 1 });
    expect(sent).toHaveLength(0);
  });

  it("inscrição que deixou de ser aprovada antes do envio → skipped", async () => {
    const sent = stubResend();
    const a = await idOf("clerk_a");
    await register(a, H);
    await reviewRegistration(a, H, "reject");
    expect(await processTicketEmails(50, { env })).toMatchObject({ skipped: 1 });
    expect(sent).toHaveLength(0);
  });

  it("reenvio manual: nova chave de idempotência; API só organizador", async () => {
    const sent = stubResend();
    const a = await idOf("clerk_a");
    await register(a, H);
    await processTicketEmails(50, { env });
    const rid = (await db.prepare("SELECT id FROM registrations WHERE memberId = ?").get<{ id: number }>(a))!.id;

    const { POST } = await import("@/app/api/admin/hackathons/[id]/ticket-email/route");
    asUser(null);
    expect((await POST(req("POST", { registrationId: rid }), params(H))).status).toBe(401);
    asUser("clerk_staff");
    expect((await POST(req("POST", { registrationId: rid }), params(H))).status).toBe(403);
    asUser("clerk_org");
    expect((await POST(req("POST", { registrationId: 999999 }), params(H))).status).toBe(404);
    const ok = await POST(req("POST", { registrationId: rid }), params(H));
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toMatchObject({ status: "queued", sends: 2 });
    await processTicketEmails(50, { env });
    expect(sent.map((s) => s.headers["Idempotency-Key"])).toEqual([`ticket-${rid}-1`, `ticket-${rid}-2`]);

    const rw = await reg("clerk_b", "waitlist");
    expect(await requeueTicketEmail(rw, H, null)).toBe("not_approved");
  });
});

// ---------------------------------------------------------------- crachás

describe("crachás", () => {
  it("lista: papel mais alto, time, QR só de quem tem inscrição aprovada, ordem alfabética", async () => {
    await reg("clerk_a", "approved");
    await reg("clerk_b", "approved");
    await reg("clerk_c", "waitlist");
    await reg("clerk_staff", "approved");
    await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Time Foguete')").run(H);
    const team = (await db.prepare("SELECT id FROM teams WHERE name = 'Time Foguete'").get<{ id: number }>())!.id;
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, 'bia_h')").run(team);

    const all = await listBadges(H);
    expect(all.map((b) => b.name)).toEqual([
      "Ana Álvares",
      "Beatriz Souza",
      "Marta Mentora",
      "Olga Organiza",
      "Sergio Staff",
    ]);
    const by = Object.fromEntries(all.map((b) => [b.username, b]));
    expect(by.bia_h).toMatchObject({ role: "participante", team: "Time Foguete" });
    expect(by.staff_h.role).toBe("staff");
    expect(by.staff_h.token).toMatch(/^HH1\./);
    expect(by.org_h).toMatchObject({ role: "organizador", token: null });
    expect((await listBadges(H, "participante")).map((b) => b.username)).toEqual(["ana_h", "bia_h"]);
  });

  it("PDF A4 com N etiquetas: ceil(N/8) páginas A4", async () => {
    const badges = Array.from({ length: 19 }, (_, i) => ({
      memberId: i,
      name: `Pessoa ${String(i).padStart(2, "0")} Çãõ`,
      username: `p${i}`,
      role: (["participante", "staff", "mentor", "jurado", "organizador"] as const)[i % 5],
      team: i % 2 ? "Time Ímpar com nome bem comprido que não cabe" : null,
      token: i % 3 ? ticketToken(i + 1) : null,
      noPhoto: i % 4 === 0,
    }));
    const bytes = await badgesPdf(badges, { hackathonName: "Hack Inova Alphaville 2026" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(Math.ceil(19 / PER_SHEET));
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it("nome com caractere fora do Latin-1 não quebra o PDF", async () => {
    const bytes = await badgesPdf(
      [{ memberId: 1, name: "Łukasz 李 Ńoé", username: "l", role: "participante", team: null, token: null }],
      { hackathonName: "X" },
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("GET …/crachas: 401 anon, 403 staff, 400 papel inválido, 200 PDF com contagem", async () => {
    const { GET } = await import("@/app/api/admin/hackathons/[id]/crachas/route");
    await reg("clerk_a", "approved");
    asUser(null);
    expect((await GET(req("GET"), params(H))).status).toBe(401);
    asUser("clerk_staff");
    expect((await GET(req("GET"), params(H))).status).toBe(403);
    asUser("clerk_org");
    expect((await GET(req("GET", undefined, "http://t/?papel=rei"), params(H))).status).toBe(400);
    const ok = await GET(req("GET", undefined, "http://t/?papel=participante&guias=1"), params(H));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("x-badge-count")).toBe("1");
    const bytes = new Uint8Array(await ok.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  });
});
