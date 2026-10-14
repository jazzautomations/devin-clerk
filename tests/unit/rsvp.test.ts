import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { effectiveCapacity, register } from "@/lib/registrations";
import {
  fromSqlTime,
  getAttendanceHistory,
  getAttendanceSummaries,
  getRsvpFunnel,
  getRsvpView,
  parseEventStart,
  personalDeadline,
  processRsvp,
  respondRsvp,
  resendRsvp,
  rsvpCsv,
  listRsvpRows,
  rsvpToken,
  rsvpWindows,
  validateRsvpConfig,
  verifyRsvpToken,
} from "@/lib/rsvp";

// RSVP anti-no-show (migration 012). Evento de referência: sábado
// 14/11/2026 09:00 em Brasília (12:00Z). D-7 = 07/11 09:00 BRT; prazo =
// fim do D-3 (11/11 23:59:59 BRT = 12/11 03:00Z exclusivo); D-1 = 13/11
// 09:00 BRT; H-2 = 14/11 07:00 BRT.

const H = "rsvp-jam";
const START = "2026-11-14T09:00:00-03:00";
const at = (iso: string) => new Date(iso);
const OPENS = at("2026-11-07T12:00:00Z");
const DEADLINE = at("2026-11-12T03:00:00Z");
const D1 = at("2026-11-13T12:00:00Z");
const H2 = at("2026-11-14T10:00:00Z");
const NOENV = {};

let seq = 0;
async function member(name = "Ana Souza") {
  const tag = `rv${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, name, email) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, name, `${tag}@t.dev`);
  return row!.id;
}

async function reg(memberId: number, status: string, hackathonId = H, waitlistedAt: string | null = null) {
  const row = await db
    .prepare(
      `INSERT INTO registrations (memberId, hackathonId, status, waitlistedAt)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(memberId, hackathonId, status, waitlistedAt);
  return row!.id;
}

const regRow = (id: number) =>
  db
    .prepare("SELECT status, rsvpStatus, rsvpDeadlineAt, rsvpReminderStage FROM registrations WHERE id = ?")
    .get<{ status: string; rsvpStatus: string | null; rsvpDeadlineAt: string | null; rsvpReminderStage: number }>(id);

const regOf = (memberId: number, hackathonId = H) =>
  db
    .prepare("SELECT id, status, rsvpStatus, rsvpDeadlineAt FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number; status: string; rsvpStatus: string | null; rsvpDeadlineAt: string | null }>(memberId, hackathonId);

async function edition(
  id = H,
  opts: { startsAt?: string; endsAt?: string | null; capacity?: number | null; rsvp?: boolean; overbook?: number } = {},
) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl,
         capacity, rsvpEnabled, overbookPercent)
       VALUES (?, ?, 'Hack Inova', ?, ?, 'presencial', 'Rua Teste, 100 — São Paulo', 'https://x.dev', ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = excluded.endsAt,
         capacity = excluded.capacity, rsvpEnabled = excluded.rsvpEnabled, overbookPercent = excluded.overbookPercent`,
    )
    .run(
      id,
      `Edição ${id}`,
      opts.startsAt ?? START,
      opts.endsAt ?? null,
      opts.capacity ?? null,
      opts.rsvp === false ? 0 : 1,
      opts.overbook ?? 0,
    );
}

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const t of ["checkins", "rsvp_messages", "rsvp_releases", "registrations"]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare("UPDATE hackathons SET rsvpEnabled = 0").run();
  await edition();
});

describe("janelas no fuso de Brasília", () => {
  it("D-7 09:00, prazo no fim do D-3, D-1 09:00 e H-2", () => {
    const w = rsvpWindows(START, { opensDaysBefore: 7, deadlineDaysBefore: 3 })!;
    expect(w.start.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(w.opensAt).toEqual(OPENS);
    expect(w.deadlineAt).toEqual(DEADLINE);
    expect(w.d1At).toEqual(D1);
    expect(w.h2At).toEqual(H2);
  });

  it("dia do evento é o de Brasília, não o de UTC (evento 23h BRT = dia seguinte em UTC)", () => {
    const w = rsvpWindows("2026-11-14T23:00:00-03:00", { opensDaysBefore: 7, deadlineDaysBefore: 3 })!;
    expect(w.opensAt.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(w.deadlineAt.toISOString()).toBe("2026-11-12T03:00:00.000Z");
  });

  it("startsAt só com data = 09:00 BRT; texto do banco sem fuso = UTC; lixo = null", () => {
    expect(parseEventStart("2027-01-09")!.toISOString()).toBe("2027-01-09T12:00:00.000Z");
    expect(parseEventStart("2027-01-09 15:30:00")!.toISOString()).toBe("2027-01-09T15:30:00.000Z");
    expect(parseEventStart("amanhã")).toBeNull();
    expect(rsvpWindows("amanhã", { opensDaysBefore: 7, deadlineDaysBefore: 3 })).toBeNull();
  });

  it("prazo individual: pelo menos 24h, nunca depois do início", () => {
    const w = rsvpWindows(START, { opensDaysBefore: 7, deadlineDaysBefore: 3 })!;
    expect(personalDeadline(w, OPENS)).toEqual(DEADLINE);
    const lateNight = at("2026-11-11T23:00:00Z");
    expect(personalDeadline(w, lateNight)).toEqual(at("2026-11-12T23:00:00Z"));
    expect(personalDeadline(w, at("2026-11-14T02:00:00Z"))).toEqual(w.start);
  });

  it("validação da configuração", () => {
    expect(validateRsvpConfig({ enabled: true, opensDaysBefore: 7, deadlineDaysBefore: 3, overbookPercent: 20 })).toEqual({
      enabled: true,
      opensDaysBefore: 7,
      deadlineDaysBefore: 3,
      overbookPercent: 20,
    });
    expect(() => validateRsvpConfig({ enabled: true, opensDaysBefore: 3, deadlineDaysBefore: 3, overbookPercent: 0 })).toThrow(
      /prazo/,
    );
    expect(() => validateRsvpConfig({ enabled: true, opensDaysBefore: 7, deadlineDaysBefore: 3, overbookPercent: 101 })).toThrow();
    expect(() => validateRsvpConfig({ opensDaysBefore: 7 })).toThrow(/ligada ou desligada/);
  });
});

describe("token HMAC", () => {
  it("válido, adulterado, expirado e de formato errado", () => {
    const exp = at("2026-11-12T03:00:00Z");
    const t = rsvpToken(42, exp);
    expect(verifyRsvpToken(t, OPENS)).toEqual({ ok: true, registrationId: 42, expiresAt: exp });
    // trocar o id (outra inscrição) invalida a assinatura
    const forged = t.replace(/^R1\.[0-9a-z]+\./, `R1.${(43).toString(36)}.`);
    expect(verifyRsvpToken(forged, OPENS)).toEqual({ ok: false, reason: "invalid" });
    // estender a validade também
    const extended = t.replace(/^(R1\.[0-9a-z]+\.)[0-9a-z]+/, `$1${(Math.floor(exp.getTime() / 1000) + 86400).toString(36)}`);
    expect(verifyRsvpToken(extended, OPENS)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyRsvpToken(t, exp)).toMatchObject({ ok: false, reason: "expired", registrationId: 42 });
    expect(verifyRsvpToken("lixo", OPENS)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyRsvpToken(undefined, OPENS)).toEqual({ ok: false, reason: "invalid" });
  });

  it("segredo vem da env; produção sem env é erro", () => {
    vi.stubEnv("HACKAHUB_RSVP_SECRET", "a");
    const a = rsvpToken(1, DEADLINE);
    vi.stubEnv("HACKAHUB_RSVP_SECRET", "b");
    expect(rsvpToken(1, DEADLINE)).not.toBe(a);
    expect(verifyRsvpToken(a, OPENS)).toEqual({ ok: false, reason: "invalid" });
    vi.stubEnv("HACKAHUB_RSVP_SECRET", "");
    vi.stubEnv("HACKAHUB_TICKET_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => rsvpToken(1, DEADLINE)).toThrow(/HACKAHUB_RSVP_SECRET/);
    vi.unstubAllEnvs();
  });
});

describe("processRsvp — convite do D-7", () => {
  it("antes da abertura não faz nada; na abertura convida só aprovados, uma vez", async () => {
    const a = await reg(await member(), "approved");
    const p = await reg(await member(), "pending");
    const w = await reg(await member(), "waitlist", H, "2026-10-01 10:00:00");
    expect((await processRsvp(at("2026-11-07T11:59:00Z"), { env: NOENV })).invited).toBe(0);
    expect((await regRow(a))!.rsvpStatus).toBeNull();

    const r = await processRsvp(OPENS, { env: NOENV });
    expect(r).toMatchObject({ editions: 1, invited: 1, expired: 0 });
    expect(await regRow(a)).toMatchObject({ rsvpStatus: "pending", rsvpDeadlineAt: "2026-11-12 03:00:00" });
    expect((await regRow(p))!.rsvpStatus).toBeNull();
    expect((await regRow(w))!.rsvpStatus).toBeNull();
    // in-app entregue; e-mail sem RESEND_API_KEY = pulado (nada sai de verdade)
    const msgs = await db
      .prepare("SELECT channel, status FROM rsvp_messages WHERE registrationId = ? ORDER BY channel")
      .all(a);
    expect(msgs).toEqual([
      { channel: "email", status: "skipped" },
      { channel: "inapp", status: "sent" },
    ]);
    // idempotente
    expect((await processRsvp(OPENS, { env: NOENV })).invited).toBe(0);
    expect((await processRsvp(at("2026-11-08T12:00:00Z"), { env: NOENV })).invited).toBe(0);
  });

  it("edição com RSVP desligado é ignorada", async () => {
    await edition(H, { rsvp: false });
    await reg(await member(), "approved");
    expect(await processRsvp(OPENS, { env: NOENV })).toMatchObject({ editions: 0, invited: 0 });
  });

  it("WhatsApp só com opt-in e telefone válido", async () => {
    const m = await member();
    await db.prepare("UPDATE members SET phone = '11999990000', whatsappOptIn = 1 WHERE id = ?").run(m);
    const id = await reg(m, "approved");
    await processRsvp(OPENS, { env: NOENV });
    const ch = await db.prepare("SELECT channel FROM rsvp_messages WHERE registrationId = ? ORDER BY channel").all(id);
    expect(ch).toEqual([{ channel: "email" }, { channel: "inapp" }, { channel: "whatsapp" }]);
  });
});

describe("confirmar / recusar pelo link", () => {
  async function invited() {
    const m = await member();
    const id = await reg(m, "approved");
    await processRsvp(OPENS, { env: NOENV });
    const row = await regRow(id);
    return { m, id, token: rsvpToken(id, fromSqlTime(row!.rsvpDeadlineAt!)) };
  }

  it("confirmar é idempotente", async () => {
    const { id, token } = await invited();
    const now = at("2026-11-09T12:00:00Z");
    expect(await respondRsvp(token, "confirm", now, NOENV)).toEqual({ ok: true, status: "confirmed", already: false });
    expect(await respondRsvp(token, "confirm", now, NOENV)).toEqual({ ok: true, status: "confirmed", already: true });
    expect((await regRow(id))!.rsvpStatus).toBe("confirmed");
    const view = await getRsvpView(token, now);
    expect(view).toMatchObject({ kind: "open", status: "confirmed", canConfirm: false, canDecline: true });
  });

  it("não vou libera a vaga, promove a fila e o promovido tem 24h; recusar de novo é idempotente", async () => {
    await edition(H, { capacity: 1 });
    const { id, token, m } = await invited();
    const next = await member("Bruno Fila");
    await reg(next, "waitlist", H, "2026-10-01 10:00:00");
    const now = at("2026-11-11T22:00:00Z"); // véspera do prazo geral
    const res = await respondRsvp(token, "decline", now, NOENV);
    expect(res).toEqual({ ok: true, status: "declined", already: false, promoted: 1 });
    expect(await regRow(id)).toBeUndefined();
    const promoted = await regOf(next);
    expect(promoted).toMatchObject({ status: "approved", rsvpStatus: "pending" });
    // decisão: o promovido precisa confirmar — 24h a partir da promoção
    expect(promoted!.rsvpDeadlineAt).toBe("2026-11-12 22:00:00");
    const release = await db.prepare("SELECT memberId, outcome FROM rsvp_releases WHERE registrationId = ?").get(id);
    expect(release).toEqual({ memberId: m, outcome: "declined" });

    expect(await respondRsvp(token, "decline", now, NOENV)).toEqual({ ok: true, status: "declined", already: true, promoted: 0 });
    expect(await respondRsvp(token, "confirm", now, NOENV)).toEqual({ ok: false, reason: "released" });
    expect(await getRsvpView(token, now)).toMatchObject({ kind: "released", outcome: "declined" });
  });

  it("confirmado pode liberar a vaga até o início; depois do início não", async () => {
    const { id, token } = await invited();
    await respondRsvp(token, "confirm", at("2026-11-08T12:00:00Z"), NOENV);
    // link do lembrete (vale até o início) — o do convite já expirou no prazo
    const after = rsvpToken(id, at("2026-11-20T00:00:00Z"));
    expect(await respondRsvp(after, "decline", at("2026-11-14T12:30:00Z"), NOENV)).toEqual({ ok: false, reason: "closed" });
    expect(await respondRsvp(after, "decline", at("2026-11-14T11:00:00Z"), NOENV)).toMatchObject({ ok: true, status: "declined" });
    const rel = await db.prepare("SELECT wasConfirmed FROM rsvp_releases").get<{ wasConfirmed: number }>();
    expect(rel!.wasConfirmed).toBe(1);
  });

  it("token inválido, expirado e de inscrição que não existe", async () => {
    const { token } = await invited();
    expect(await respondRsvp(token.slice(0, -2) + "xx", "confirm", OPENS, NOENV)).toEqual({ ok: false, reason: "invalid" });
    expect(await respondRsvp(token, "confirm", DEADLINE, NOENV)).toEqual({ ok: false, reason: "expired" });
    expect(await getRsvpView(token, DEADLINE)).toMatchObject({ kind: "expired" });
    const ghost = rsvpToken(999_999, DEADLINE);
    expect(await respondRsvp(ghost, "confirm", OPENS, NOENV)).toEqual({ ok: false, reason: "not_found" });
    expect(await getRsvpView(ghost, OPENS)).toEqual({ kind: "not_found" });
    expect(await getRsvpView("lixo", OPENS)).toEqual({ kind: "invalid" });
  });

  it("inscrição sem convite (pendente de curadoria) não responde", async () => {
    const id = await reg(await member(), "pending");
    expect(await respondRsvp(rsvpToken(id, DEADLINE), "confirm", OPENS, NOENV)).toEqual({ ok: false, reason: "not_invited" });
  });
});

// e-mail ligado (Resend de mentira): o convite sai como `sent`
const MAILENV = { RESEND_API_KEY: "re_teste" };
function stubResend() {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "ok" }), { status: 200 }));
}

describe("expiração no fim do D-3", () => {
  it("sem e-mail configurado ninguém expira: o convite só ficou no site (auditoria 041)", async () => {
    await edition(H, { capacity: 1 });
    const quiet = await member("Sumido");
    const q = await reg(quiet, "approved");
    const wait = await member("Na Fila");
    await reg(wait, "waitlist", H, "2026-10-01 10:00:00");
    await processRsvp(OPENS, { env: NOENV });
    const r = await processRsvp(DEADLINE, { env: NOENV });
    expect(r).toMatchObject({ expired: 0, held: 1, promoted: 0 });
    expect((await regRow(q))!.rsvpStatus).toBe("pending");
    expect(await regOf(wait)).toMatchObject({ status: "waitlist" });
  });

  it("pendente expira, libera vaga, fila anda e o promovido é convidado; confirmado fica; rodar de novo é no-op", async () => {
    stubResend();
    await edition(H, { capacity: 2 });
    const quiet = await member("Sumido");
    const sure = await member("Firme");
    const q = await reg(quiet, "approved");
    const s = await reg(sure, "approved");
    const wait = await member("Na Fila");
    await reg(wait, "waitlist", H, "2026-10-01 10:00:00");
    await processRsvp(OPENS, { env: MAILENV });
    await respondRsvp(rsvpToken(s, DEADLINE), "confirm", at("2026-11-10T12:00:00Z"), NOENV);

    expect((await processRsvp(at("2026-11-12T02:59:00Z"), { env: MAILENV })).expired).toBe(0);
    const r = await processRsvp(DEADLINE, { env: MAILENV });
    expect(r).toMatchObject({ expired: 1, promoted: 1, invited: 1 });
    expect(await regRow(q)).toBeUndefined();
    expect((await regRow(s))!.rsvpStatus).toBe("confirmed");
    expect(await regOf(wait)).toMatchObject({ status: "approved", rsvpStatus: "pending", rsvpDeadlineAt: "2026-11-13 03:00:00" });
    expect(await db.prepare("SELECT outcome FROM rsvp_releases WHERE memberId = ?").get(quiet)).toEqual({ outcome: "expired" });

    expect(await processRsvp(DEADLINE, { env: MAILENV })).toMatchObject({ expired: 0, invited: 0, promoted: 0 });
    vi.unstubAllGlobals();
    const funnel = await getRsvpFunnel(H);
    expect(funnel).toMatchObject({ approved: 3, invited: 3, confirmed: 1, pending: 1, expired: 1, declined: 0 });
  });

  it("depois do início nada expira (liberar vaga com o evento rolando não serve)", async () => {
    const id = await reg(await member(), "approved");
    await db
      .prepare("UPDATE registrations SET rsvpStatus = 'pending', rsvpDeadlineAt = '2026-11-14 12:00:00' WHERE id = ?")
      .run(id);
    expect((await processRsvp(at("2026-11-14T12:30:00Z"), { env: NOENV })).expired).toBe(0);
    expect((await regRow(id))!.rsvpStatus).toBe("pending");
  });
});

describe("lembretes D-1 e H-2", () => {
  it("só pra confirmados, uma vez cada", async () => {
    const yes = await reg(await member(), "approved");
    const maybe = await reg(await member(), "approved");
    await processRsvp(OPENS, { env: NOENV });
    await respondRsvp(rsvpToken(yes, DEADLINE), "confirm", at("2026-11-08T12:00:00Z"), NOENV);
    // maybe recebeu prazo estendido? não — ainda pendente no D-1 só se o prazo for depois
    await db.prepare("UPDATE registrations SET rsvpDeadlineAt = '2026-11-14 12:00:00' WHERE id = ?").run(maybe);

    expect((await processRsvp(at("2026-11-13T11:59:00Z"), { env: NOENV })).d1).toBe(0);
    expect((await processRsvp(D1, { env: NOENV })).d1).toBe(1);
    expect((await processRsvp(at("2026-11-13T18:00:00Z"), { env: NOENV })).d1).toBe(0);
    expect((await regRow(yes))!.rsvpReminderStage).toBe(1);
    expect((await regRow(maybe))!.rsvpReminderStage).toBe(0);

    expect((await processRsvp(H2, { env: NOENV })).h2).toBe(1);
    expect((await processRsvp(at("2026-11-14T11:00:00Z"), { env: NOENV })).h2).toBe(0);
    const kinds = await db
      .prepare("SELECT kind, COUNT(*) AS n FROM rsvp_messages WHERE registrationId = ? AND channel = 'inapp' GROUP BY kind ORDER BY kind")
      .all(yes);
    expect(kinds).toEqual([
      { kind: "d1", n: 1 },
      { kind: "h2", n: 1 },
      { kind: "invite", n: 1 },
    ]);
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM rsvp_messages WHERE registrationId = ? AND kind IN ('d1','h2')").get(maybe),
    ).toEqual({ n: 0 });
  });

  it("quem confirma já na janela do H-2 recebe só o H-2", async () => {
    const id = await reg(await member(), "approved");
    await db
      .prepare("UPDATE registrations SET rsvpStatus = 'confirmed', rsvpDeadlineAt = '2026-11-13 03:00:00' WHERE id = ?")
      .run(id);
    const r = await processRsvp(at("2026-11-14T10:30:00Z"), { env: NOENV });
    expect(r).toMatchObject({ d1: 0, h2: 1 });
    expect((await regRow(id))!.rsvpReminderStage).toBe(2);
  });

  it("reenvio manual: convite pra pendente, logística pra confirmado, com freio", async () => {
    const m = await member();
    await reg(m, "approved");
    expect(await resendRsvp(H, m, OPENS, NOENV)).toEqual({ ok: false, reason: "not_invited" });
    await processRsvp(OPENS, { env: NOENV });
    expect(await resendRsvp(H, m, at("2026-11-08T12:00:00Z"), NOENV)).toMatchObject({ ok: true, kind: "invite" });
    expect(await resendRsvp(H, m, at("2026-11-08T12:02:00Z"), NOENV)).toEqual({ ok: false, reason: "cooldown" });
    await db.prepare("UPDATE registrations SET rsvpStatus = 'confirmed' WHERE memberId = ?").run(m);
    expect(await resendRsvp(H, m, at("2026-11-13T12:00:00Z"), NOENV)).toMatchObject({ ok: true, kind: "d1" });
    expect(await resendRsvp(H, m, at("2026-11-14T12:30:00Z"), NOENV)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("sobrevenda", () => {
  it("capacidade efetiva só com RSVP ligado", () => {
    expect(effectiveCapacity({ capacity: 100, rsvpEnabled: 1, overbookPercent: 25 })).toBe(125);
    expect(effectiveCapacity({ capacity: 10, rsvpEnabled: 1, overbookPercent: 15 })).toBe(11);
    expect(effectiveCapacity({ capacity: 100, rsvpEnabled: 0, overbookPercent: 25 })).toBe(100);
    expect(effectiveCapacity({ capacity: null, rsvpEnabled: 1, overbookPercent: 25 })).toBeNull();
  });

  it("aprovação usa a capacidade efetiva", async () => {
    await edition("rsvp-over", { capacity: 2, overbook: 50 });
    const out = [];
    for (let i = 0; i < 4; i++) out.push((await register(await member(), "rsvp-over")).status);
    expect(out).toEqual(["approved", "approved", "approved", "waitlist"]);
  });
});

describe("histórico de comparecimento", () => {
  it("compareceu / faltou / liberou; edição sem check-in não entra", async () => {
    await edition("past-a", { startsAt: "2026-03-07T09:00:00-03:00", rsvp: false });
    await edition("past-b", { startsAt: "2026-05-09T09:00:00-03:00", rsvp: false });
    await edition("past-nocheckin", { startsAt: "2026-06-06T09:00:00-03:00", rsvp: false });
    const me = await member();
    const other = await member();
    const a = await reg(me, "approved", "past-a");
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(a);
    const b = await reg(me, "approved", "past-b");
    await db.prepare("UPDATE registrations SET rsvpStatus = 'confirmed' WHERE id = ?").run(b);
    // past-b usou check-in (outra pessoa passou na porta)
    const ob = await reg(other, "approved", "past-b");
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(ob);
    await reg(me, "approved", "past-nocheckin");
    // e liberou uma vaga no RSVP desta edição
    await db
      .prepare("INSERT INTO rsvp_releases (registrationId, hackathonId, memberId, outcome) VALUES (?, ?, ?, 'declined')")
      .run(777_001, H, me);

    const now = at("2026-11-20T12:00:00Z");
    const { entries, summary } = await getAttendanceHistory(me, now);
    expect(summary).toMatchObject({ compareceu: 1, faltou: 1, recusou: 1, expirou: 0, total: 3 });
    expect(entries.map((e) => [e.hackathonId, e.outcome])).toEqual([
      [H, "recusou"],
      ["past-b", "faltou"],
      ["past-a", "compareceu"],
    ]);
    // curadoria: resumo sem a edição curada
    const map = await getAttendanceSummaries([me, other], H, now);
    expect(map[me]).toMatchObject({ compareceu: 1, faltou: 1, recusou: 0, total: 2 });
    expect(map[other]).toMatchObject({ compareceu: 1, total: 1 });
  });

  it("edição que ainda não acabou não conta falta", async () => {
    const me = await member();
    const id = await reg(me, "approved");
    await db.prepare("UPDATE registrations SET rsvpStatus = 'confirmed' WHERE id = ?").run(id);
    const other = await reg(await member(), "approved");
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(other);
    expect((await getAttendanceHistory(me, at("2026-11-14T15:00:00Z"))).summary.total).toBe(0);
    expect((await getAttendanceHistory(me, at("2026-11-16T15:00:00Z"))).summary.faltou).toBe(1);
  });
});

describe("export", () => {
  it("CSV com estado e sem fórmula de planilha", async () => {
    const m = await member("=HYPERLINK(\"x\")");
    await reg(m, "approved");
    await processRsvp(OPENS, { env: NOENV });
    const csv = rsvpCsv(await listRsvpRows(H));
    expect(csv.split("\n")[0]).toBe("username,nome,email,rsvp,prazo,respondeu_em,check_in");
    expect(csv).toContain("aguardando");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
