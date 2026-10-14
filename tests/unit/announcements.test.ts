import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import {
  fanOut,
  listAnnouncementsForAdmin,
  listAnnouncementsForMember,
  markAnnouncementsRead,
  MAX_ATTEMPTS,
  processDeliveries,
  publishAnnouncement,
  recipientsFor,
  validateAnnouncementInput,
} from "@/lib/announcements";
import { markEmailBounced } from "@/lib/contact";

// spec 033 US2 / FR-003 — avisos da edição: público-alvo, fan-out
// idempotente, worker com retry/backoff, opt-in de WhatsApp e bounce.

const H = "avisos-unit";
const LIVE_ENV = {
  RESEND_API_KEY: "re_test",
  EVOLUTION_URL: "https://evo.test",
  EVOLUTION_INSTANCE: "hi",
  EVOLUTION_API_KEY: "evo",
};

let seq = 0;
async function member(opts: { phone?: string; optIn?: boolean } = {}): Promise<number> {
  const tag = `av${seq++}`;
  const row = await db
    .prepare(
      `INSERT INTO members (clerkId, username, email, phone, whatsappOptIn)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, opts.phone ?? null, opts.optIn ? 1 : 0);
  return row!.id;
}

async function registered(status: string, opts?: { phone?: string; optIn?: boolean }) {
  const id = await member(opts);
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
    .run(id, H, status);
  return id;
}

async function deliveries(announcementId: number) {
  return db
    .prepare(
      `SELECT memberId, channel, status, error, attempts, nextAttemptAt
       FROM deliveries WHERE announcementId = ? ORDER BY memberId, channel`,
    )
    .all<{ memberId: number; channel: string; status: string; error: string | null; attempts: number; nextAttemptAt: string | null }>(announcementId);
}

function mockFetch(status = 200) {
  const fn = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  await db.prepare("DELETE FROM deliveries").run();
  await db.prepare("DELETE FROM announcement_reads").run();
  await db.prepare("DELETE FROM announcements").run();
  await db.prepare("DELETE FROM notifications").run();
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(H);
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl)
       VALUES (?, 'Avisos Unit', 'Hack Inova', '2027-01-01', 'presencial', 'https://x.dev')`,
    )
    .run(H);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("validateAnnouncementInput", () => {
  it("exige título, corpo e público válido; time exige teamId", () => {
    expect(() => validateAnnouncementInput({ audience: "todos", title: "", body: "x" })).toThrow();
    expect(() => validateAnnouncementInput({ audience: "geral", title: "t", body: "x" })).toThrow();
    expect(() => validateAnnouncementInput({ audience: "time", title: "t", body: "x" })).toThrow();
    expect(validateAnnouncementInput({ audience: "aprovados", title: " t ", body: " b " })).toEqual({
      audience: "aprovados",
      teamId: null,
      title: "t",
      body: "b",
    });
    expect(validateAnnouncementInput({ audience: "time", teamId: 3, title: "t", body: "b" }).teamId).toBe(3);
  });
});

describe("recipientsFor — público-alvo", () => {
  it("todos = approved + pending + fila de espera (sem rejected); aprovados = approved", async () => {
    const a = await registered("approved");
    const p = await registered("pending");
    await registered("rejected");
    const w = await registered("waitlist");
    const todos = (await recipientsFor(H, "todos")).map((r) => r.memberId).sort();
    expect(todos).toEqual([a, p, w].sort());
    const aprovados = (await recipientsFor(H, "aprovados")).map((r) => r.memberId);
    expect(aprovados).toEqual([a]);
  });

  it("time = membros do time daquela edição", async () => {
    const a = await registered("approved");
    await registered("approved");
    const username = (await db.prepare("SELECT username FROM members WHERE id = ?").get<{ username: string }>(a))!.username;
    const team = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Time A') RETURNING id")
      .get<{ id: number }>(H);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(team!.id, username);
    expect((await recipientsFor(H, "time", team!.id)).map((r) => r.memberId)).toEqual([a]);
  });

  it("presentes = aprovados com check-in", async () => {
    const veio = await registered("approved");
    await registered("approved");
    await db
      .prepare(
        `INSERT INTO checkins (registrationId)
         SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?`,
      )
      .run(veio, H);
    expect((await recipientsFor(H, "presentes")).map((r) => r.memberId)).toEqual([veio]);
  });
});

describe("publicar + fan-out", () => {
  it("cria inapp + email pra cada destinatário e whatsapp só com opt-in + telefone", async () => {
    const semZap = await registered("approved");
    const comZap = await registered("approved", { phone: "5511999999999", optIn: true });
    const optInSemFone = await registered("approved", { optIn: true });
    const foneSemOptIn = await registered("approved", { phone: "5511988887777" });
    const { id, queued } = await publishAnnouncement(H, null, { audience: "aprovados", teamId: null, title: "T", body: "B" });
    expect(queued).toBe(4 * 2 + 1);
    const rows = await deliveries(id);
    const zap = rows.filter((r) => r.channel === "whatsapp").map((r) => r.memberId);
    expect(zap).toEqual([comZap]);
    for (const m of [semZap, optInSemFone, foneSemOptIn]) {
      expect(rows.filter((r) => r.memberId === m).map((r) => r.channel).sort()).toEqual(["email", "inapp"]);
    }
    expect(rows.every((r) => r.status === "queued")).toBe(true);
  });

  it("idempotente: fan-out 2× não duplica entrega", async () => {
    await registered("approved");
    await registered("pending");
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    expect(await fanOut(id)).toBe(0);
    expect(await deliveries(id)).toHaveLength(4);
  });
});

describe("processDeliveries — worker", () => {
  it("processar 2× não reenvia: cada (aviso, membro, canal) sai uma vez", async () => {
    const fetchFn = mockFetch(200);
    await registered("approved", { phone: "5511999999999", optIn: true });
    await registered("approved");
    const { id } = await publishAnnouncement(H, null, { audience: "aprovados", teamId: null, title: "T", body: "B" });
    const first = await processDeliveries(50, { env: LIVE_ENV });
    expect(first.processed).toBe(5);
    const second = await processDeliveries(50, { env: LIVE_ENV });
    expect(second.processed).toBe(0);
    // 2 e-mails + 1 whatsapp; inapp não usa rede
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect((await deliveries(id)).every((r) => r.status === "sent")).toBe(true);
    const notifs = await db.prepare("SELECT type, href FROM notifications").all<{ type: string; href: string }>();
    expect(notifs).toHaveLength(2);
    expect(notifs[0]).toMatchObject({ type: "announcement", href: `/h/${H}#avisos` });
  });

  it("driver log em dev: sem env, e-mail/zap viram skipped com motivo e nada sai", async () => {
    const fetchFn = mockFetch(200);
    await registered("approved", { phone: "5511999999999", optIn: true });
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    await processDeliveries(50, { env: {} });
    expect(fetchFn).not.toHaveBeenCalled();
    const rows = await deliveries(id);
    expect(rows.find((r) => r.channel === "inapp")!.status).toBe("sent");
    expect(rows.find((r) => r.channel === "email")).toMatchObject({ status: "skipped", error: expect.stringContaining("RESEND_API_KEY") });
    expect(rows.find((r) => r.channel === "whatsapp")).toMatchObject({ status: "skipped", error: expect.stringContaining("EVOLUTION") });
  });

  it("opt-in retirado depois do fan-out: whatsapp vira skipped, sem rede", async () => {
    const fetchFn = mockFetch(200);
    const m = await registered("approved", { phone: "5511999999999", optIn: true });
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    await db.prepare("UPDATE members SET whatsappOptIn = 0 WHERE id = ?").run(m);
    await processDeliveries(50, { env: LIVE_ENV });
    expect((await deliveries(id)).find((r) => r.channel === "whatsapp")).toMatchObject({ status: "skipped", error: expect.stringContaining("opt-in") });
    expect(fetchFn).toHaveBeenCalledTimes(1); // só o e-mail
  });

  it("bounce: e-mail marcado não recebe (skipped, sem rede)", async () => {
    const fetchFn = mockFetch(200);
    const m = await registered("approved");
    const email = (await db.prepare("SELECT email FROM members WHERE id = ?").get<{ email: string }>(m))!.email;
    expect(await markEmailBounced(email.toUpperCase())).toBe(1);
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    await processDeliveries(50, { env: LIVE_ENV });
    expect((await deliveries(id)).find((r) => r.channel === "email")).toMatchObject({ status: "skipped", error: expect.stringContaining("bounce") });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("retry com backoff: falha transitória espera, tenta de novo, para em 3 tentativas", async () => {
    const fetchFn = mockFetch(503);
    await registered("approved");
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    const t0 = new Date("2027-01-01T10:00:00Z");
    await processDeliveries(50, { env: LIVE_ENV, now: t0 });
    let email = (await deliveries(id)).find((r) => r.channel === "email")!;
    expect(email).toMatchObject({ status: "failed", attempts: 1, nextAttemptAt: "2027-01-01 10:01:00" });

    // antes do backoff vencer não tenta
    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-01T10:00:30Z") });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-01T10:01:00Z") });
    email = (await deliveries(id)).find((r) => r.channel === "email")!;
    expect(email).toMatchObject({ status: "failed", attempts: 2, nextAttemptAt: "2027-01-01 10:06:00" });

    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-01T10:06:00Z") });
    email = (await deliveries(id)).find((r) => r.channel === "email")!;
    expect(email).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, nextAttemptAt: null });

    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-02T00:00:00Z") });
    expect(fetchFn).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("falha permanente (4xx) não insiste", async () => {
    const fetchFn = mockFetch(422);
    await registered("approved");
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-01T10:00:00Z") });
    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-03T10:00:00Z") });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await deliveries(id)).find((r) => r.channel === "email")).toMatchObject({ status: "failed", nextAttemptAt: null });
  });

  it("recupera falha → sent na segunda tentativa", async () => {
    const fn = vi
      .fn(async () => new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("x", { status: 500 }));
    vi.stubGlobal("fetch", fn);
    await registered("approved");
    const { id } = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-01T10:00:00Z") });
    await processDeliveries(50, { env: LIVE_ENV, now: new Date("2027-01-01T10:02:00Z") });
    expect((await deliveries(id)).find((r) => r.channel === "email")).toMatchObject({ status: "sent", attempts: 2, error: null });
  });
});

describe("leitura", () => {
  it("admin vê contagem por canal/status e a lista de falhas", async () => {
    mockFetch(422);
    await registered("approved");
    await registered("approved");
    await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "T", body: "B" });
    await processDeliveries(50, { env: { RESEND_API_KEY: "k" } });
    const [a] = await listAnnouncementsForAdmin(H);
    expect(a.stats.inapp).toEqual({ queued: 0, sent: 2, failed: 0, skipped: 0 });
    expect(a.stats.email).toEqual({ queued: 0, sent: 0, failed: 2, skipped: 0 });
    expect(a.failures).toHaveLength(2);
    expect(a.failures[0]).toMatchObject({ channel: "email", error: expect.stringContaining("422") });
  });

  it("inscrito vê avisos do público dele, mais recente primeiro, não lidos destacados", async () => {
    const ap = await registered("approved");
    const pe = await registered("pending");
    const team = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Outro') RETURNING id").get<{ id: number }>(H);
    const a1 = await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "primeiro", body: "B" });
    const a2 = await publishAnnouncement(H, null, { audience: "aprovados", teamId: null, title: "segundo", body: "B" });
    await publishAnnouncement(H, null, { audience: "time", teamId: team!.id, title: "do time", body: "B" });

    const forAp = await listAnnouncementsForMember(H, ap);
    expect(forAp.map((a) => a.title)).toEqual(["segundo", "primeiro"]);
    expect(forAp.every((a) => !a.read)).toBe(true);
    expect((await listAnnouncementsForMember(H, pe)).map((a) => a.title)).toEqual(["primeiro"]);

    await markAnnouncementsRead(ap, [a1.id, a2.id]);
    await markAnnouncementsRead(ap, [a1.id]); // idempotente
    expect((await listAnnouncementsForMember(H, ap)).every((a) => a.read)).toBe(true);
  });

  it("quem se inscreve depois vê o histórico de 'todos'", async () => {
    await publishAnnouncement(H, null, { audience: "todos", teamId: null, title: "antigo", body: "B" });
    const novo = await registered("approved");
    expect((await listAnnouncementsForMember(H, novo)).map((a) => a.title)).toEqual(["antigo"]);
  });
});
