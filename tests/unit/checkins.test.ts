import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getOrCreateMember } from "@/lib/members";
import {
  checkIn,
  checkinCounts,
  findRegistrationByToken,
  getTicket,
  isCheckedIn,
  listCheckins,
  searchRegistrants,
  ticketSecret,
  ticketToken,
} from "@/lib/checkins";

// spec 033 US4 — check-in por QR. O QR carrega um token assinado
// (HMAC do registrationId), nunca o id cru.

const H = "hack-inova-alphaville-2026";
const OTHER = "hack-inova-unifacens-2026";

async function member(clerkId: string, email: string, name: string | null = null) {
  return getOrCreateMember({ id: clerkId, firstName: name, lastName: null, email });
}

async function registration(memberId: number, hackathonId: string, status: string) {
  await db
    .prepare(
      `INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)
       ON CONFLICT ("memberId", "hackathonId") DO UPDATE SET status = excluded.status`,
    )
    .run(memberId, hackathonId, status);
  const row = await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(memberId, hackathonId);
  return row!.id;
}

beforeEach(async () => {
  await db.prepare("DELETE FROM checkins").run();
  await db.prepare("DELETE FROM registrations").run();
  // check-in só vale na janela do evento: a edição acontece hoje
  const today = new Date().toISOString();
  await db.prepare("UPDATE hackathons SET startsAt = ?, endsAt = ? WHERE id IN (?, ?)").run(today, today, H, OTHER);
});

describe("janela do check-in (auditoria 041)", () => {
  it("fora da janela é recusado; admin forçando marca e fica registrado", async () => {
    const m = await member("clerk_win", "win@t.dev", "Wil");
    const rid = await registration(m.id, H, "approved");
    await db.prepare("UPDATE hackathons SET startsAt = '2026-11-07', endsAt = '2026-11-08' WHERE id = ?").run(H);
    const early = new Date("2026-10-20T12:00:00Z");
    const r = await checkIn(H, { registrationId: rid }, null, { now: early });
    expect(r).toMatchObject({ ok: false, reason: "outside_window" });
    expect(await isCheckedIn(rid)).toBe(false);
    // véspera às 09:00 de Brasília (12:00Z) já abre
    expect(await checkIn(H, { registrationId: rid }, null, { now: new Date("2026-11-06T12:30:00Z") })).toMatchObject({
      ok: true,
    });
    await db.prepare("DELETE FROM checkins").run();
    const forced = await checkIn(H, { registrationId: rid }, null, { now: early, force: true });
    expect(forced).toMatchObject({ ok: true });
    expect(await db.prepare("SELECT \"outsideWindow\" AS o FROM checkins WHERE registrationId = ?").get(rid)).toEqual({ o: 1 });
    // quem já tem presença continua vendo o horário, mesmo fora da janela
    expect(await checkIn(H, { registrationId: rid }, null, { now: early })).toMatchObject({ ok: true, already: true });
  });
});

describe("token do ingresso", () => {
  it("é determinístico, não contém o id cru e muda com o id", async () => {
    const t1 = ticketToken(41);
    expect(t1).toBe(ticketToken(41));
    expect(t1).not.toBe(ticketToken(42));
    expect(t1).toMatch(/^HH1\.[A-Za-z0-9_-]{43}$/);
    expect(t1.slice(4)).not.toContain("41");
  });

  it("segredo vem da env; em produção sem env é erro", () => {
    vi.stubEnv("HACKAHUB_TICKET_SECRET", "segredo-a");
    const a = ticketToken(7);
    vi.stubEnv("HACKAHUB_TICKET_SECRET", "segredo-b");
    expect(ticketToken(7)).not.toBe(a);
    vi.stubEnv("HACKAHUB_TICKET_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => ticketSecret()).toThrow(/HACKAHUB_TICKET_SECRET/);
    vi.stubEnv("NODE_ENV", "test");
    expect(ticketSecret()).toBeTruthy();
    vi.unstubAllEnvs();
  });

  it("acha a inscrição pelo token só dentro da edição", async () => {
    const m = await member("c_tok", "tok@t.dev");
    const rid = await registration(m.id, H, "approved");
    expect((await findRegistrationByToken(H, ticketToken(rid)))?.id).toBe(rid);
    expect(await findRegistrationByToken(OTHER, ticketToken(rid))).toBeNull();
    expect(await findRegistrationByToken(H, "HH1." + "A".repeat(43))).toBeNull();
    expect(await findRegistrationByToken(H, "lixo")).toBeNull();
  });
});

describe("checkIn", () => {
  it("primeira leitura marca presença; a segunda é idempotente", async () => {
    const staff = await member("c_st", "st@t.dev");
    const m = await member("c_ok", "ok@t.dev", "Ana");
    const rid = await registration(m.id, H, "approved");

    const first = await checkIn(H, { token: ticketToken(rid) }, staff.id);
    expect(first).toMatchObject({ ok: true, already: false, registrationId: rid, name: "Ana" });
    expect(await isCheckedIn(rid)).toBe(true);

    const second = await checkIn(H, { token: ticketToken(rid) }, staff.id);
    expect(second).toMatchObject({ ok: true, already: true, registrationId: rid });
    if (first.ok && second.ok) expect(second.at).toBe(first.at);
    expect((await listCheckins(H)).length).toBe(1);
    expect((await listCheckins(H))[0]).toMatchObject({ registrationId: rid, byMemberId: staff.id });
  });

  it("aceita registrationId direto (busca manual) mas só da edição", async () => {
    const m = await member("c_man", "man@t.dev");
    const rid = await registration(m.id, H, "approved");
    expect(await checkIn(OTHER, { registrationId: rid }, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await checkIn(H, { registrationId: rid }, null)).toMatchObject({ ok: true, already: false });
  });

  it("token de outra edição ou forjado → not_found; malformado → invalid", async () => {
    const m = await member("c_oth", "oth@t.dev");
    const rid = await registration(m.id, OTHER, "approved");
    expect(await checkIn(H, { token: ticketToken(rid) }, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await checkIn(H, { token: "HH1." + "B".repeat(43) }, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await checkIn(H, { token: "123" }, null)).toEqual({ ok: false, reason: "invalid" });
    expect(await isCheckedIn(rid)).toBe(false);
  });

  it("pendente e rejeitado são recusados sem marcar presença", async () => {
    const p = await member("c_pen", "pen@t.dev");
    const r = await member("c_rej", "rej@t.dev");
    const pid = await registration(p.id, H, "pending");
    const rjid = await registration(r.id, H, "rejected");
    expect(await checkIn(H, { token: ticketToken(pid) }, null)).toMatchObject({ ok: false, reason: "pending" });
    expect(await checkIn(H, { registrationId: rjid }, null)).toMatchObject({ ok: false, reason: "rejected" });
    expect(await listCheckins(H)).toEqual([]);
  });
});

describe("contagem, busca e ingresso", () => {
  it("conta inscritos / aprovados / presentes", async () => {
    const a = await member("c_c1", "c1@t.dev");
    const b = await member("c_c2", "c2@t.dev");
    const c = await member("c_c3", "c3@t.dev");
    const ra = await registration(a.id, H, "approved");
    await registration(b.id, H, "approved");
    await registration(c.id, H, "pending");
    await checkIn(H, { registrationId: ra }, null);
    expect(await checkinCounts(H)).toEqual({ inscritos: 3, aprovados: 2, presentes: 1 });
    expect(await checkinCounts(OTHER)).toEqual({ inscritos: 0, aprovados: 0, presentes: 0 });
  });

  it("busca por nome, e-mail ou username dentro da edição", async () => {
    const a = await member("c_s1", "beatriz.souza@t.dev", "Beatriz");
    const b = await member("c_s2", "carlos@t.dev", "Carlos");
    await registration(a.id, H, "approved");
    await registration(b.id, OTHER, "approved");
    expect((await searchRegistrants(H, "beatriz")).map((r) => r.memberId)).toEqual([a.id]);
    expect((await searchRegistrants(H, "SOUZA@T")).map((r) => r.memberId)).toEqual([a.id]);
    expect((await searchRegistrants(H, a.username)).map((r) => r.memberId)).toEqual([a.id]);
    expect(await searchRegistrants(H, "carlos")).toEqual([]);
    expect(await searchRegistrants(H, " ")).toEqual([]);
    expect(await searchRegistrants(H, "%")).toEqual([]);
  });

  it("ingresso: só de quem tem inscrição; traz token e presença", async () => {
    const m = await member("c_tk", "tk@t.dev");
    expect(await getTicket(m.id, H)).toBeNull();
    const rid = await registration(m.id, H, "approved");
    const t = await getTicket(m.id, H);
    expect(t).toMatchObject({ registrationId: rid, status: "approved", token: ticketToken(rid), checkedInAt: null });
    await checkIn(H, { registrationId: rid }, null);
    expect((await getTicket(m.id, H))?.checkedInAt).toBeTruthy();
  });

  it("cancelar inscrição apaga a presença junto (FK em cascata)", async () => {
    const m = await member("c_del", "del@t.dev");
    const rid = await registration(m.id, H, "approved");
    await checkIn(H, { registrationId: rid }, null);
    await db.prepare("DELETE FROM registrations WHERE id = ?").run(rid);
    expect(await isCheckedIn(rid)).toBe(false);
  });
});

describe("check-in × fila de espera (frente B)", () => {
  it("quem está na fila de espera não entra", async () => {
    const m = await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES ('c_fila', 'fila', 'fila@t.dev') RETURNING id")
      .get<{ id: number }>();
    const reg = await db
      .prepare(
        "INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, 'hack-inova-alphaville-2026', 'waitlist') RETURNING id",
      )
      .get<{ id: number }>(m!.id);
    const r = await checkIn("hack-inova-alphaville-2026", { registrationId: reg!.id }, null);
    expect(r).toMatchObject({ ok: false, reason: "waitlist" });
    expect(await isCheckedIn(reg!.id)).toBe(false);
  });
});
