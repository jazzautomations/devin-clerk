import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";
import {
  ANON_VIEWER,
  calendarToken,
  calendarTokenFor,
  canSeeAudience,
  changeNoticeText,
  countScheduleItems,
  createScheduleItem,
  formatShift,
  groupByDay,
  listScheduleItems,
  listVisibleScheduleItems,
  nowAndNext,
  notifyScheduleChange,
  parseCalendarToken,
  publishSchedule,
  resolveCalendarToken,
  rotateCalendarToken,
  scheduleRecipients,
  scheduleViewerFor,
  shiftSchedule,
  spLocalToUtc,
  toIcsEvent,
  updateScheduleItem,
  utcToSp,
  validateScheduleInput,
  wallClockDelta,
  type ScheduleInput,
  type ScheduleItem,
  type ScheduleViewer,
} from "@/lib/schedule";

// Programação da edição (roadmap 037 #4): fuso, validação, visibilidade
// por público, aviso idempotente na mudança, token do feed pessoal.

const H = "prog-unit";
const ED = { startsAt: "2026-11-14T09:00:00-03:00", endsAt: "2026-11-15T18:00:00-03:00" };
let seq = 0;

async function member(opts: { status?: string; role?: "mentor" | "jurado" | "staff" | "organizador" } = {}) {
  const tag = `su${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
  if (opts.status) {
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
      .run(row!.id, H, opts.status);
  }
  if (opts.role) await grantEditionRole(H, row!.id, opts.role, null);
  return { id: row!.id, role: "member" };
}

const form = (over: Record<string, unknown> = {}) => ({
  title: "Almoço",
  date: "2026-11-14",
  start: "12:00",
  end: "13:00",
  room: "Refeitório",
  audience: "todos",
  kind: "refeicao",
  ...over,
});

beforeEach(async () => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl)
       VALUES (?, 'Prog Unit', 'Hack Inova', ?, ?, 'presencial', 'Alphaville', 'https://x.dev')`,
    )
    .run(H, ED.startsAt, ED.endsAt);
  await db.prepare("DELETE FROM schedule_items").run();
  await db.prepare("DELETE FROM edition_roles WHERE hackathonId = ?").run(H);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(H);
});

describe("fuso de São Paulo", () => {
  it("converte hora local ↔ UTC (UTC−3) e recusa data impossível", () => {
    expect(spLocalToUtc("2026-11-14", "09:30")).toBe("2026-11-14 12:30:00");
    expect(spLocalToUtc("2026-11-14", "22:00")).toBe("2026-11-15 01:00:00");
    expect(utcToSp("2026-11-15 01:00:00")).toEqual({ date: "2026-11-14", time: "22:00" });
    expect(spLocalToUtc("2026-02-31", "10:00")).toBeNull();
    expect(spLocalToUtc("2026-11-14", "25:00")).toBeNull();
    expect(spLocalToUtc("ontem", "10:00")).toBeNull();
  });
});

describe("validateScheduleInput", () => {
  it("normaliza pra UTC e aplica padrões", () => {
    const v = validateScheduleInput(form({ title: "  Almoço  ", audience: undefined, kind: undefined }), ED);
    expect(v).toMatchObject({
      title: "Almoço",
      startsAt: "2026-11-14 15:00:00",
      endsAt: "2026-11-14 16:00:00",
      audience: "todos",
      kind: "outro",
    });
  });

  it("fim tem que ser depois do início", () => {
    expect(() => validateScheduleInput(form({ end: "12:00" }), ED)).toThrow(/fim tem que ser depois/);
    expect(() => validateScheduleInput(form({ end: "11:00" }), ED)).toThrow(/fim tem que ser depois/);
    // virando a noite com dia do fim explícito vale
    const night = validateScheduleInput(form({ start: "23:00", end: "01:00", endDate: "2026-11-15" }), ED);
    expect(night.endsAt).toBe("2026-11-15 04:00:00");
  });

  it("dentro do período da edição com folga de 1 dia", () => {
    expect(() => validateScheduleInput(form({ date: "2026-11-13", start: "18:00", end: "19:00" }), ED)).not.toThrow();
    expect(() => validateScheduleInput(form({ date: "2026-11-12" }), ED)).toThrow(/fora do período/);
    expect(() => validateScheduleInput(form({ date: "2026-11-16", start: "10:00", end: "11:00" }), ED)).not.toThrow();
    expect(() => validateScheduleInput(form({ date: "2026-11-17" }), ED)).toThrow(/fora do período/);
  });

  it("recusa título vazio, público e tipo inválidos", () => {
    expect(() => validateScheduleInput(form({ title: " " }), ED)).toThrow(/título/);
    expect(() => validateScheduleInput(form({ audience: "vip" }), ED)).toThrow(/público/);
    expect(() => validateScheduleInput(form({ kind: "festa" }), ED)).toThrow(/tipo/);
    expect(() => validateScheduleInput(form({ start: "" }), ED)).toThrow(/início/);
    expect(() => validateScheduleInput(null, ED)).toThrow();
  });
});

describe("visibilidade por público", () => {
  it("canSeeAudience: todos pra qualquer um; o resto por papel/inscrição", () => {
    const participant: ScheduleViewer = { manager: false, roles: [], participant: true };
    const mentor = { manager: false, roles: ["mentor" as const], participant: false };
    const manager = { manager: true, roles: [], participant: false };
    expect(canSeeAudience("todos", ANON_VIEWER)).toBe(true);
    for (const a of ["participantes", "mentores", "jurados", "staff"] as const) {
      expect(canSeeAudience(a, ANON_VIEWER)).toBe(false);
      expect(canSeeAudience(a, manager)).toBe(true);
    }
    expect(canSeeAudience("participantes", participant)).toBe(true);
    expect(canSeeAudience("mentores", participant)).toBe(false);
    expect(canSeeAudience("mentores", mentor)).toBe(true);
    expect(canSeeAudience("participantes", mentor)).toBe(true);
    expect(canSeeAudience("jurados", mentor)).toBe(false);
  });

  it("lista só publicados que o viewer pode ver; rascunho só no painel", async () => {
    const open = await createScheduleItem(H, validateScheduleInput(form({ title: "Abertura" }), ED), null);
    const ment = await createScheduleItem(H, validateScheduleInput(form({ title: "Briefing mentores", audience: "mentores" }), ED), null);
    await createScheduleItem(H, validateScheduleInput(form({ title: "Rascunho" }), ED), null);
    await publishSchedule(H, [open.id, ment.id]);

    const titles = (xs: ScheduleItem[]) => xs.map((i) => i.title).sort();
    expect(titles(await listVisibleScheduleItems(H, ANON_VIEWER))).toEqual(["Abertura"]);
    const mentor = await member({ role: "mentor" });
    expect(titles(await listVisibleScheduleItems(H, await scheduleViewerFor(mentor, H)))).toEqual([
      "Abertura",
      "Briefing mentores",
    ]);
    const approved = await member({ status: "approved" });
    expect(titles(await listVisibleScheduleItems(H, await scheduleViewerFor(approved, H)))).toEqual(["Abertura"]);
    expect(titles(await listScheduleItems(H, { includeDrafts: true }))).toHaveLength(3);
  });
});

describe("agora / a seguir e dias", () => {
  const item = (id: number, startsAt: string, endsAt: string) =>
    ({ id, title: `i${id}`, startsAt, endsAt }) as ScheduleItem;
  const items = [
    item(1, "2026-11-14 12:00:00", "2026-11-14 13:00:00"),
    item(2, "2026-11-14 12:30:00", "2026-11-14 15:00:00"),
    item(3, "2026-11-14 15:00:00", "2026-11-14 16:00:00"),
    item(4, "2026-11-14 17:00:00", "2026-11-14 18:00:00"),
    item(5, "2026-11-15 02:00:00", "2026-11-15 03:00:00"),
  ];

  it("agora = começou e não acabou; a seguir = próximos, limitado", () => {
    const r = nowAndNext(items, new Date("2026-11-14T12:45:00Z"));
    expect(r.now.map((i) => i.id)).toEqual([1, 2]);
    expect(r.next.map((i) => i.id)).toEqual([3, 4]);
    // fim é exclusivo
    expect(nowAndNext(items, new Date("2026-11-14T13:00:00Z")).now.map((i) => i.id)).toEqual([2]);
  });

  it("agrupa por dia em São Paulo (02h UTC ainda é o dia anterior)", () => {
    const days = groupByDay(items);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-11-14");
    expect(days[0].label).toMatch(/14 de novembro/);
    expect(days[0].items).toHaveLength(5);
  });
});

describe("aviso automático de mudança", () => {
  async function published(input: Partial<Record<string, unknown>> = {}) {
    const it = await createScheduleItem(H, validateScheduleInput(form(input), ED), null);
    await publishSchedule(H, [it.id]);
    return (await listScheduleItems(H)).find((x) => x.id === it.id)!;
  }
  const countAnnouncements = async () =>
    (await db.prepare("SELECT COUNT(*) AS n FROM announcements WHERE hackathonId = ?").get<{ n: number }>(H))!.n;
  const moved = (over: Record<string, unknown>): ScheduleInput => validateScheduleInput(form(over), ED);

  it("mudar horário de item publicado avisa só o público do item, com o texto combinado", async () => {
    const m1 = await member({ role: "mentor" });
    await member({ status: "approved" });
    const item = await published({ title: "Briefing", audience: "mentores", room: "Sala 3" });
    const before = await countAnnouncements();
    const r = await updateScheduleItem(H, item.id, moved({ title: "Briefing", audience: "mentores", start: "14:00", end: "15:00", room: "Sala 3" }), null);
    expect(r!.announcementId).not.toBeNull();
    expect(r!.item.revision).toBe(1);
    expect(await countAnnouncements()).toBe(before + 1);
    const a = await db
      .prepare("SELECT audience, title, body FROM announcements WHERE id = ?")
      .get<{ audience: string; title: string; body: string }>(r!.announcementId);
    expect(a!.audience).toBe("lista");
    expect(a!.title).toBe("mudou: Briefing agora às 14:00 na sala Sala 3");
    expect(a!.body).toMatch(/Antes era .*12:00–13:00/);
    const inapp = await db
      .prepare("SELECT memberId FROM deliveries WHERE announcementId = ? AND channel = 'inapp'")
      .all<{ memberId: number }>(r!.announcementId);
    expect(inapp.map((d) => d.memberId)).toEqual([m1.id]);
  });

  it("idempotente por alteração: repetir a mesma revisão não publica de novo", async () => {
    await member({ status: "approved" });
    const item = await published();
    const r = await updateScheduleItem(H, item.id, moved({ room: "Pátio" }), null);
    expect(r!.announcementId).not.toBeNull();
    const n = await countAnnouncements();
    // retry / clique duplo / worker repetido com a mesma revisão
    expect(await notifyScheduleChange(r!.item, item, null)).toBeNull();
    expect(await notifyScheduleChange(r!.item, item, null)).toBeNull();
    // salvar o mesmo valor de novo não é alteração
    const again = await updateScheduleItem(H, item.id, moved({ room: "Pátio" }), null);
    expect(again!.announcementId).toBeNull();
    expect(again!.item.revision).toBe(r!.item.revision);
    expect(await countAnnouncements()).toBe(n);
    // nova alteração (volta pro lugar antigo) é outra revisão → outro aviso
    const back = await updateScheduleItem(H, item.id, moved({}), null);
    expect(back!.announcementId).not.toBeNull();
    expect(await countAnnouncements()).toBe(n + 1);
  });

  it("rascunho, mudança só de título e item sem público não avisam", async () => {
    await member({ status: "approved" });
    const draft = await createScheduleItem(H, validateScheduleInput(form(), ED), null);
    const d = await updateScheduleItem(H, draft.id, moved({ start: "15:00", end: "16:00" }), null);
    expect(d!.announcementId).toBeNull();
    const item = await published();
    expect((await updateScheduleItem(H, item.id, moved({ title: "Almoço livre" }), null))!.announcementId).toBeNull();
    const judges = await published({ audience: "jurados" });
    expect((await updateScheduleItem(H, judges.id, moved({ audience: "jurados", room: "X" }), null))!.announcementId).toBeNull();
  });

  it("destinatários por público", async () => {
    const appr = await member({ status: "approved" });
    const pend = await member({ status: "pending" });
    await member({ status: "rejected" });
    const st = await member({ role: "staff" });
    const ju = await member({ role: "jurado" });
    expect(await scheduleRecipients(H, "participantes")).toEqual([appr.id]);
    expect(await scheduleRecipients(H, "staff")).toEqual([st.id]);
    expect(await scheduleRecipients(H, "jurados")).toEqual([ju.id]);
    expect(await scheduleRecipients(H, "todos")).toEqual([appr.id, pend.id, st.id, ju.id].sort((a, b) => a - b));
  });

  it("mudança de dia aparece no título", () => {
    const t = changeNoticeText(
      { title: "Pitch", hackathonId: H, startsAt: "2026-11-15 13:00:00", endsAt: "2026-11-15 14:00:00", room: "" },
      { startsAt: "2026-11-14 13:00:00", endsAt: "2026-11-14 14:00:00", room: "" },
    );
    expect(t.title).toMatch(/^mudou: Pitch agora às 10:00 \(dom 15\/11\)$/);
  });
});

describe("token do feed pessoal", () => {
  it("assinado: adulterar invalida; revogar mata o link antigo", async () => {
    const m = await member({ status: "approved" });
    const t1 = await calendarTokenFor(m.id, H);
    expect(await calendarTokenFor(m.id, H)).toBe(t1);
    expect(await resolveCalendarToken(t1)).toEqual({ memberId: m.id, hackathonId: H });
    expect(parseCalendarToken(`${t1}x`)).toBeNull();
    expect(parseCalendarToken(calendarToken(m.id + 1, H, 1).replace(/\.[^.]+$/, t1.slice(t1.lastIndexOf("."))))).toBeNull();
    expect(parseCalendarToken("HC1.lixo")).toBeNull();
    const t2 = await rotateCalendarToken(m.id, H);
    expect(t2).not.toBe(t1);
    expect(await resolveCalendarToken(t1)).toBeNull();
    expect(await resolveCalendarToken(t2)).toEqual({ memberId: m.id, hackathonId: H });
  });
});

describe("edição mudou de data → deslocar a programação (frente N #7)", () => {
  const DAY = 86_400_000;

  it("formatShift e wallClockDelta (parede do relógio, ignora fuso)", () => {
    expect(formatShift(2 * DAY)).toBe("+2 dias");
    expect(formatShift(-3 * 3_600_000)).toBe("−3 h");
    expect(formatShift(DAY + 2 * 3_600_000 + 30 * 60_000)).toBe("+1 dia, 2 h e 30 min");
    // o form devolve sem fuso; o antigo pode ter -03:00 — só o relógio conta
    expect(wallClockDelta("2026-11-14T09:00:00-03:00", "2026-11-16T09:00")).toBe(2 * DAY);
    expect(wallClockDelta("2026-11-14T09:00:00-03:00", "2026-11-14T09:00")).toBe(0);
    expect(wallClockDelta("2027-01-01", "2027-01-01T10:00")).toBe(3_600_000);
    expect(wallClockDelta("lixo", "2026-11-14T09:00")).toBeNull();
  });

  it("desloca todos os itens, sobe revision (SEQUENCE do .ics) e avisa os inscritos UMA vez", async () => {
    const ok = await member({ status: "approved" });
    const pend = await member({ status: "pending" });
    const mentor = await member({ role: "mentor" });
    const a = await createScheduleItem(H, validateScheduleInput(form({ title: "Abertura", start: "09:00", end: "10:00" }), ED), null);
    const b = await createScheduleItem(H, validateScheduleInput(form({ title: "Almoço" }), ED), null);
    const draft = await createScheduleItem(H, validateScheduleInput(form({ title: "Rascunho" }), ED), null);
    await publishSchedule(H, [a.id, b.id]);
    expect(await countScheduleItems(H)).toEqual({ total: 3, published: 2 });
    const before = await db.prepare("SELECT COUNT(*) AS n FROM announcements WHERE hackathonId = ?").get<{ n: number }>(H);

    const r = await shiftSchedule(H, 2 * DAY, null);
    expect(r.moved).toBe(3);
    const items = await listScheduleItems(H, { includeDrafts: true });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(a.id)).toMatchObject({ startsAt: "2026-11-16 12:00:00", endsAt: "2026-11-16 13:00:00", revision: 1 });
    expect(byId.get(b.id)).toMatchObject({ startsAt: "2026-11-16 15:00:00", revision: 1 });
    expect(byId.get(draft.id)!.startsAt).toBe("2026-11-16 15:00:00");
    // .ics: mesmo UID, SEQUENCE maior → o calendário de quem assinou atualiza
    const ics = toIcsEvent(byId.get(a.id)!, { name: "Prog Unit", location: "Alphaville" });
    expect(ics.sequence).toBe(1);
    expect(ics.uid).toBe(toIcsEvent(a, { name: "Prog Unit", location: "Alphaville" }).uid);

    const after = await db.prepare("SELECT COUNT(*) AS n FROM announcements WHERE hackathonId = ?").get<{ n: number }>(H);
    expect(Number(after!.n) - Number(before!.n)).toBe(1);
    const ann = await db
      .prepare("SELECT title, body FROM announcements WHERE id = ?")
      .get<{ title: string; body: string }>(r.announcementId);
    expect(ann!.title).toContain("a agenda mudou");
    expect(ann!.title).toContain("+2 dias");
    expect(ann!.body).toContain("(.ics)");
    const to = await db
      .prepare("SELECT memberId FROM deliveries WHERE announcementId = ? AND channel = 'inapp' ORDER BY memberId")
      .all<{ memberId: number }>(r.announcementId);
    expect(to.map((x) => x.memberId)).toEqual([ok.id, pend.id, mentor.id].sort((x, y) => x - y));

    // o aviso por item da mesma revision não dispara de novo
    expect(await notifyScheduleChange(byId.get(a.id)!, a, null)).toBeNull();
  });

  it("delta 0 é no-op; programação só de rascunho desloca sem avisar ninguém", async () => {
    await member({ status: "approved" });
    await createScheduleItem(H, validateScheduleInput(form(), ED), null);
    expect(await shiftSchedule(H, 0, null)).toEqual({ moved: 0, announcementId: null });
    const r = await shiftSchedule(H, -3_600_000, null);
    expect(r).toEqual({ moved: 1, announcementId: null });
    expect((await listScheduleItems(H, { includeDrafts: true }))[0].startsAt).toBe("2026-11-14 14:00:00");
  });
});
