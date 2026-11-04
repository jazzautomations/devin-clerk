import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { toDbTime } from "@/lib/entries";
import {
  CLOSED_BY_PERIOD,
  canSeeFollowThroughGrid,
  closeFollowThrough,
  followThroughGrid,
  getFollowThrough,
  joinFollowThrough,
  openFollowThrough,
  parseOpenInput,
  runFollowThrough,
} from "@/lib/followThrough";
import { resetRateLimits } from "@/lib/ratelimit";

// 4 semanas depois (spec 046, onda 5, migration 052): abrir, entrar, grade,
// encerrar e cron. Semana conta pelo post do diário do time (posts.teamId,
// Onda 3) dentro da janela; o relógio é injetado em tudo.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const DAY = 86_400_000;
/** segunda 09:00 em Brasília — o período começa aqui nos testes */
const T0 = new Date("2026-11-02T12:00:00Z");
/** quinta da semana 1, 09:00 em Brasília */
const THURSDAY = new Date("2026-11-05T12:00:00Z");

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(role = "member"): Promise<M> {
  const tag = `qs${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};

async function edition(endsAt: Date | null): Promise<string> {
  const id = `qs-edicao-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Hack Inova Teste', ?, ?, 'presencial', ?, '[]', 1, 'painel')`,
    )
    .run(id, `Edição ${id}`, toDbTime(new Date((endsAt?.getTime() ?? T0.getTime()) - DAY)), endsAt ? toDbTime(endsAt) : null, `/h/${id}`);
  return id;
}

async function organizer(hackathonId: string): Promise<M> {
  const m = await member();
  await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')").run(hackathonId, m.id);
  return m;
}

async function team(hackathonId: string, usernames: string[], delivered = true): Promise<number> {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, ?)").run(t!.id, `Projeto ${t!.id}`);
  if (delivered) {
    await db
      .prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')")
      .run(t!.id);
  }
  return t!.id;
}

async function post(teamId: number, memberId: number, at: Date): Promise<number> {
  const row = await db
    .prepare("INSERT INTO posts (memberId, body, teamId, createdAt) VALUES (?, 'atualização', ?, ?) RETURNING id")
    .get<{ id: number }>(memberId, teamId, toDbTime(at));
  return row!.id;
}

const req = (body?: unknown) =>
  new Request("http://t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const routes = {
  open: () => import("@/app/api/hackathons/[id]/quatro-semanas/route"),
  close: () => import("@/app/api/hackathons/[id]/quatro-semanas/close/route"),
  teams: () => import("@/app/api/hackathons/[id]/quatro-semanas/teams/route"),
  cron: () => import("@/app/api/cron/quatro-semanas/route"),
};

const notes = (memberId: number, type: string) =>
  db.prepare("SELECT text, href FROM notifications WHERE memberId = ? AND type = ? ORDER BY id").all<{ text: string; href: string }>(memberId, type);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("validação pura", () => {
  const now = new Date("2026-11-20T12:00:00Z");

  it("o período começa agora (ou no fim da edição) e vai de 2 a 8 semanas", () => {
    expect(parseOpenInput({}, { now, end: null })).toEqual({
      value: { startsAt: now, weeks: 4, demoMeetupId: null },
    });
    const end = new Date("2026-11-25T21:00:00Z");
    expect(parseOpenInput({ weeks: "6" }, { now, end })).toEqual({ value: { startsAt: end, weeks: 6, demoMeetupId: null } });
    expect(parseOpenInput({ weeks: 1 }, { now, end })).toEqual({ error: "De 2 a 8 semanas." });
    expect(parseOpenInput({ weeks: 9 }, { now, end })).toEqual({ error: "De 2 a 8 semanas." });
    expect(parseOpenInput({ demoMeetupId: "abc" }, { now, end })).toEqual({ error: "Demo day inválido." });
  });

  it("o início fica entre hoje e 14 dias; data ruim não passa", () => {
    expect(parseOpenInput({ startsAt: "lixo" }, { now, end: null })).toEqual({ error: "Data de início inválida." });
    expect(parseOpenInput({ startsAt: "2026-11-10T09:00" }, { now, end: null })).toEqual({
      error: "As 4 semanas começam hoje ou depois.",
    });
    expect(parseOpenInput({ startsAt: "2026-12-20T09:00" }, { now, end: null })).toEqual({
      error: "As 4 semanas começam em até 14 dias.",
    });
    const ok = parseOpenInput({ startsAt: "2026-11-21T09:00" }, { now, end: null });
    expect("value" in ok && ok.value.startsAt.toISOString()).toBe("2026-11-21T12:00:00.000Z");
  });
});

describe("abrir", () => {
  it("401 deslogado, 403 membro comum, 404 edição inexistente, 201 organizador e 409 na segunda", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    const comum = await member();
    const { POST } = await routes.open();

    expect((await POST(req({}), ctx(ed))).status).toBe(401);
    as(comum);
    expect((await POST(req({}), ctx(ed))).status).toBe(403);
    // 404 só pra admin: quem não organiza a edição leva 403 antes de saber se
    // ela existe (nada de enumerar edição pela API)
    expect((await POST(req({}), ctx("nao-existe"))).status).toBe(403);
    as(await member("admin"));
    expect((await POST(req({}), ctx("nao-existe"))).status).toBe(404);
    as(org);
    const res = await POST(req({}), ctx(ed));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { followThrough: { weeks: number; startsAt: string } };
    expect(body.followThrough.weeks).toBe(4);
    const again = await POST(req({}), ctx(ed));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("As 4 semanas já estão abertas.");
  });

  it("400 quando a edição não tem fim ou já passou dos 30 dias", async () => {
    const semFim = await edition(null);
    const orgSemFim = await organizer(semFim);
    const velha = await edition(new Date(T0.getTime() - 40 * DAY));
    const orgVelha = await organizer(velha);

    await expect(openFollowThrough({ id: orgSemFim.id, role: "member" }, semFim, {}, T0)).rejects.toThrow(
      "A edição ainda não tem data de fim.",
    );
    await expect(openFollowThrough({ id: orgVelha.id, role: "member" }, velha, {}, T0)).rejects.toThrow(
      "As 4 semanas abrem até 30 dias depois do fim da edição.",
    );
  });
});

describe("entrar", () => {
  it("time sem entrega não entra, time de outra edição dá 404 e quem não é do time dá 403", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    const ana = await member();
    const beto = await member();
    const semEntrega = await team(ed, [ana.username], false);
    const comEntrega = await team(ed, [ana.username]);
    const outra = await edition(new Date(T0.getTime() - DAY));
    const deOutra = await team(outra, [ana.username]);

    await expect(joinFollowThrough(ana, ed, semEntrega, T0)).rejects.toThrow("Só time que entregou projeto na edição entra.");
    await expect(joinFollowThrough(ana, ed, deOutra, T0)).rejects.toThrow("Time não encontrado nesta edição.");
    await expect(joinFollowThrough(beto, ed, comEntrega, T0)).rejects.toThrow("Só quem está no time entra por ele.");
  });

  it("integrante entra (201), repetir é 200 e o time é avisado uma vez", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    const ana = await member();
    const beto = await member();
    const t = await team(ed, [ana.username, beto.username]);
    const { POST } = await routes.teams();

    as(ana);
    const res = await POST(req({ teamId: t }), ctx(ed));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ joined: true, teamName: expect.stringContaining("Time") });
    const again = await POST(req({ teamId: t }), ctx(ed));
    expect(again.status).toBe(200);
    expect((await again.json()).joined).toBe(false);

    const href = `/h/${ed}/quatro-semanas`;
    expect(await notes(beto.id, "follow_through_join")).toEqual([{ text: expect.stringContaining("entrou nas 4 semanas depois."), href }]);
    // quem entrou não recebe aviso de si mesmo
    expect(await notes(ana.id, "follow_through_join")).toEqual([]);
  });

  it("sem as 4 semanas abertas dá 404 e depois da semana 1 ninguém entra", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    const ana = await member();
    const t = await team(ed, [ana.username]);
    await expect(joinFollowThrough(ana, ed, t, T0)).rejects.toThrow("As 4 semanas não estão abertas.");

    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    await expect(joinFollowThrough(ana, ed, t, new Date(T0.getTime() + 8 * DAY))).rejects.toThrow(
      "Entrar vale até o fim da primeira semana.",
    );
  });
});

describe("grade e visibilidade", () => {
  it("semana conta pelo primeiro post do time na janela; post fora da janela não conta", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    const ana = await member();
    const t = await team(ed, [ana.username]);
    await joinFollowThrough(ana, ed, t, T0);

    // antes do início e depois do fim não contam
    await post(t, ana.id, new Date(T0.getTime() - 2 * DAY));
    await post(t, ana.id, new Date(T0.getTime() + 40 * DAY));
    // semana 1: dois posts, vale o primeiro
    const first = await post(t, ana.id, new Date(T0.getTime() + 2 * DAY));
    await post(t, ana.id, new Date(T0.getTime() + 3 * DAY));
    // semana 3
    const third = await post(t, ana.id, new Date(T0.getTime() + 15 * DAY));

    const ft = (await getFollowThrough(ed))!;
    const grid = await followThroughGrid(ft, new Date(T0.getTime() + 16 * DAY));
    expect(grid.teams).toHaveLength(1);
    expect(grid.teams[0].weeks).toEqual([first, null, third, null]);
    expect(grid.teams[0].done).toBe(2);
    expect(grid.teams[0].complete).toBe(false);
    expect(grid.currentWeek).toBe(3);
    expect(grid.aggregate).toEqual({ teams: 1, postedThisWeek: 1, completed: 0 });
  });

  it("a grade é do time e de quem organiza; quem é de fora não vê", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    const ana = await member();
    const fora = await member();
    const t = await team(ed, [ana.username]);
    await joinFollowThrough(ana, ed, t, T0);

    expect(await canSeeFollowThroughGrid({ id: org.id, role: "member" }, ed)).toBe(true);
    expect(await canSeeFollowThroughGrid({ id: ana.id, role: "member" }, ed)).toBe(true);
    expect(await canSeeFollowThroughGrid({ id: fora.id, role: "member" }, ed)).toBe(false);
    expect(await canSeeFollowThroughGrid(null, ed)).toBe(false);
  });
});

describe("encerrar", () => {
  it("403 quem não organiza, 400 sem motivo, encerra e não encerra de novo", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    const ana = await member();
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);

    await expect(closeFollowThrough({ id: ana.id, role: "member" }, ed, "chega", T0)).rejects.toThrow(
      "Só quem organiza a edição encerra as 4 semanas.",
    );
    await expect(closeFollowThrough({ id: org.id, role: "member" }, ed, " ", T0)).rejects.toThrow(
      "Escreva o motivo do encerramento.",
    );
    const ft = await closeFollowThrough({ id: org.id, role: "member" }, ed, "o time parou o projeto", T0);
    expect(ft.closedReason).toBe("o time parou o projeto");
    await expect(closeFollowThrough({ id: org.id, role: "member" }, ed, "de novo", T0)).rejects.toThrow(
      "As 4 semanas já estão encerradas.",
    );
  });
});

describe("cron", () => {
  it("materializa as semanas e lembra uma vez na quinta, só quem não postou", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    const ana = await member();
    const beto = await member();
    const calado = await member();
    const comPost = await team(ed, [ana.username]);
    const semPost = await team(ed, [beto.username, calado.username]);
    await joinFollowThrough(ana, ed, comPost, T0);
    await joinFollowThrough(beto, ed, semPost, T0);
    await post(comPost, ana.id, new Date(T0.getTime() + DAY));

    // terça: materializa, sem lembrete
    const terca = await runFollowThrough(new Date(T0.getTime() + DAY));
    // o cron varre todas as 4 semanas abertas no banco (o arquivo cria várias)
    expect(terca.editions).toBeGreaterThanOrEqual(1);
    expect(terca.reminders).toBe(0);
    const rows = await db
      .prepare("SELECT teamId, week, postId, remindedAt FROM follow_through_weeks WHERE hackathonId = ? ORDER BY teamId")
      .all<{ teamId: number; week: number; postId: number | null; remindedAt: string | null }>(ed);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.week === 1 && r.remindedAt === null)).toBe(true);
    expect(rows.find((r) => Number(r.teamId) === comPost)!.postId).not.toBeNull();
    expect(rows.find((r) => Number(r.teamId) === semPost)!.postId).toBeNull();

    // quinta: um lembrete pro time sem post, uma vez
    const quinta = await runFollowThrough(THURSDAY);
    // o arquivo abre outras 4 semanas com times sem post: o cron lembra todas
    expect(quinta.reminders).toBeGreaterThanOrEqual(1);
    expect(await notes(beto.id, "follow_through_reminder")).toEqual([
      {
        text: "Semana 1 de 4: o diário do time ainda não tem a atualização desta semana. Dá tempo até domingo.",
        href: `/h/${ed}/quatro-semanas`,
      },
    ]);
    expect(await notes(calado.id, "follow_through_reminder")).toHaveLength(1);
    expect(await notes(ana.id, "follow_through_reminder")).toHaveLength(0);
    expect((await runFollowThrough(THURSDAY)).reminders).toBe(0);
  });

  it("no fim concede o selo a quem fechou as semanas, avisa e fecha o período", async () => {
    const ed = await edition(new Date(T0.getTime() - DAY));
    const org = await organizer(ed);
    await openFollowThrough({ id: org.id, role: "member" }, ed, {}, T0);
    const ana = await member();
    const beto = await member();
    const completo = await team(ed, [ana.username]);
    const incompleto = await team(ed, [beto.username]);
    await joinFollowThrough(ana, ed, completo, T0);
    await joinFollowThrough(beto, ed, incompleto, T0);
    for (const week of [0, 1, 2, 3]) await post(completo, ana.id, new Date(T0.getTime() + week * 7 * DAY + DAY));
    // o incompleto pula a semana 2
    for (const week of [0, 2, 3]) await post(incompleto, beto.id, new Date(T0.getTime() + week * 7 * DAY + DAY));

    const fim = new Date(T0.getTime() + 29 * DAY);
    const r = await runFollowThrough(fim);
    expect(r.badges).toBe(1);
    expect(r.closed).toBeGreaterThanOrEqual(1);
    expect(await db.prepare("SELECT badgeId FROM member_badges WHERE memberId = ?").all(ana.id)).toEqual([
      { badgeId: "quatro-semanas" },
    ]);
    expect(await db.prepare("SELECT badgeId FROM member_badges WHERE memberId = ?").all(beto.id)).toEqual([]);
    expect(await notes(ana.id, "follow_through_badge")).toHaveLength(1);
    const ft = (await getFollowThrough(ed))!;
    expect(ft.closedReason).toBe(CLOSED_BY_PERIOD);
    expect(ft.closedAt).not.toBeNull();

    // rodar de novo não duplica selo nem aviso
    const again = await runFollowThrough(new Date(fim.getTime() + DAY));
    expect(again.badges).toBe(0);
    expect(await notes(ana.id, "follow_through_badge")).toHaveLength(1);
  });

  it("o cron exige o segredo (401) e responde o resumo com ele", async () => {
    const { POST } = await routes.cron();
    expect((await POST(req())).status).toBe(401);
    process.env.HACKAHUB_CRON_SECRET = "segredo-de-teste";
    try {
      const res = await POST(
        new Request("http://t", { method: "POST", headers: { Authorization: "Bearer segredo-de-teste" } }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ editions: expect.any(Number), badges: expect.any(Number) });
    } finally {
      delete process.env.HACKAHUB_CRON_SECRET;
    }
  });
});
