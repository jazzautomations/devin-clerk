import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { EVIDENCE_MIN_CHECKINS } from "@/lib/evidence";
import {
  LEAGUE_LIST_MAX,
  bandFor,
  bandMap,
  bandSentence,
  leagueBreakdown,
  leagueDistribution,
  leagueOptIn,
  leaguePoints,
  leagueStanding,
  ligaEnabled,
  previousSemester,
  rankingOptIn,
  semester,
  semesterWindow,
  setLeagueOptIn,
} from "@/lib/league";

// Liga do semestre por faixa (spec 046, onda 5: liga-por-faixa, migration
// 054). Cada teste confere a conta contra fixtures montadas à mão: o semestre
// em Brasília, os pontos (entrega + prêmio + semana do "4 semanas"), a faixa
// (nunca posição numérica) e a lista só com quem ativou o opt-in.
//
// "agora" dos fixtures é 04/11/2026 (ago–dez 2026); a edição que pontua vive
// em setembro de 2026 e a que fica de fora, em março de 2025.

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: null })) }));

const NOW = new Date("2026-11-04T13:00:00Z");
const SEM = semester(NOW);

let seq = 0;
type M = { id: number; username: string };

async function member(tag = "lg"): Promise<M> {
  const t = `${tag}${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`, `Pessoa ${t}`);
  return { id: r!.id, username: `u_${t}` };
}

type EdOpts = { startsAt: string; endsAt: string; submissionDeadline: string };
async function edition(opts: EdOpts): Promise<string> {
  const id = `liga-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source,
         publishedAt, submissionDeadline)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel', '2025-01-01 00:00:00', ?)`,
    )
    .run(id, `Hack ${id}`, opts.startsAt, opts.endsAt, opts.submissionDeadline);
  return id;
}

async function checkin(memberId: number, hackathonId: string, at = "2026-09-01 12:00:00") {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(memberId, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, ?)").run(r!.id, at);
}

async function crowd(hackathonId: string, n: number) {
  for (let i = 0; i < n; i++) await checkin((await member("pl")).id, hackathonId, "2026-09-01 12:00:00");
}

async function team(hackathonId: string, usernames: string[]): Promise<number> {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const u of usernames)
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  return t!.id;
}

async function submit(teamId: number, at: string) {
  await db
    .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, 1, '{}', ?)")
    .run(teamId, at);
}

async function prize(hackathonId: string, teamId: number, at: string) {
  const c = await db
    .prepare("INSERT INTO prize_categories (hackathonId, kind, name) VALUES (?, 'geral', ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Geral ${seq++}`);
  await db
    .prepare("INSERT INTO prize_winners (categoryId, teamId, place, createdAt) VALUES (?, ?, 1, ?)")
    .run(c!.id, teamId, at);
}

async function role(hackathonId: string, memberId: number, r: string) {
  await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, ?)").run(hackathonId, memberId, r);
}

// uma edição elegível no semestre (setembro/2026) e outra fora (março/2025),
// com a plateia de 15 check-ins que as duas precisam
let base: { sem: string; past: string } | null = null;
async function setup() {
  if (base) return base;
  const sem = await edition({
    startsAt: "2026-09-01T09:00:00-03:00",
    endsAt: "2026-09-02T18:00:00-03:00",
    submissionDeadline: "2026-09-02T18:00:00-03:00",
  });
  await crowd(sem, EVIDENCE_MIN_CHECKINS);
  const past = await edition({
    startsAt: "2025-03-01T09:00:00-03:00",
    endsAt: "2025-03-02T18:00:00-03:00",
    submissionDeadline: "2025-03-02T18:00:00-03:00",
  });
  await crowd(past, EVIDENCE_MIN_CHECKINS);
  base = { sem, past };
  return base;
}

describe("semestre (a temporada da 043)", () => {
  it("mar–jul e ago–dez em Brasília, com fim exclusivo", () => {
    expect(SEM).toMatchObject({ key: "2026-2", label: "ago–dez 2026" });
    expect(SEM.start.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(SEM.end.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(semesterWindow(SEM).until.toISOString()).toBe("2027-01-01T02:59:59.000Z");

    const primeiro = semester(new Date("2026-06-15T12:00:00Z"));
    expect(primeiro).toMatchObject({ key: "2026-1", label: "mar–jul 2026" });
    expect(primeiro.start.toISOString()).toBe("2026-03-01T03:00:00.000Z");
    expect(primeiro.end.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("1º de março 00:00 em Brasília já é temporada nova (o UTC ainda é fevereiro)", () => {
    expect(semester(new Date("2026-03-01T02:00:00Z"))).toMatchObject({ key: "2025-2", label: "ago–dez 2025" });
    expect(semester(new Date("2026-03-01T03:00:00Z"))).toMatchObject({ key: "2026-1" });
  });

  it("janeiro e fevereiro ficam com o semestre que acabou", () => {
    expect(semester(new Date("2027-01-15T12:00:00Z"))).toMatchObject({ key: "2026-2", label: "ago–dez 2026" });
    expect(semester(new Date("2027-02-28T23:00:00Z"))).toMatchObject({ key: "2026-2" });
  });

  it("o passado de cada semestre", () => {
    expect(previousSemester(SEM)).toMatchObject({ key: "2026-1", label: "mar–jul 2026" });
    expect(previousSemester(semester(new Date("2026-06-15T12:00:00Z")))).toMatchObject({ key: "2025-2" });
  });
});

describe("faixa", () => {
  it("sem ponto é 'começando', com ou sem gente na frente", () => {
    expect(bandFor(0, [])).toBe("começando");
    expect(bandFor(0, [60, 100])).toBe("começando");
  });

  it("só uma pessoa com ponto: ela é top 10%", () => {
    expect(bandFor(60, [])).toBe("top 10%");
    expect(bandFor(60, [0])).toBe("top 10%");
  });

  it("10 pessoas com ponto: 1ª top 10%, 2ª e 3ª top 25%, 4ª e 5ª top 50%, o resto começando", () => {
    const others = [90, 80, 70, 60, 50, 40, 30, 20, 10];
    expect(bandFor(100, others)).toBe("top 10%");
    expect(bandFor(90, [100, 80, 70, 60, 50, 40, 30, 20, 10])).toBe("top 25%");
    expect(bandFor(80, [100, 90, 70, 60, 50, 40, 30, 20, 10])).toBe("top 25%");
    expect(bandFor(70, [100, 90, 80, 60, 50, 40, 30, 20, 10])).toBe("top 50%");
    expect(bandFor(60, [100, 90, 80, 70, 50, 40, 30, 20, 10])).toBe("top 50%");
    expect(bandFor(50, [100, 90, 80, 70, 60, 40, 30, 20, 10])).toBe("começando");
  });

  it("empate divide a mesma faixa (posição de competição)", () => {
    expect(bandFor(60, [60, 30])).toBe("top 10%");
    expect(bandFor(30, [60, 60])).toBe("começando");
  });

  it("bandMap devolve a faixa de cada um da distribuição", () => {
    const dist = new Map([
      [1, 100],
      [2, 60],
      [3, 0],
    ]);
    const bands = bandMap(dist);
    expect(bands.get(1)).toBe("top 10%");
    // liga de duas pessoas: a segunda está fora dos 50% melhores
    expect(bands.get(2)).toBe("começando");
    expect(bands.get(3)).toBe("começando");
  });

  it("a frase da faixa nunca é uma posição", () => {
    expect(bandSentence("top 25%")).toBe("Você está no top 25% da liga.");
    expect(bandSentence("começando")).toBe("Você está começando nesta temporada.");
    expect(bandSentence("começando", 60)).toBe("Você está começando a subir na liga.");
    for (const b of ["top 10%", "top 25%", "top 50%", "começando"] as const) {
      expect(bandSentence(b, 60)).not.toMatch(/#\d/);
    }
  });
});

describe("pontos do semestre", () => {
  it("entrega travada (60) e prêmio (100) no semestre somam 160; presença não pontua", async () => {
    const { sem } = await setup();
    const ana = await member();
    await checkin(ana.id, sem);
    const t = await team(sem, [ana.username]);
    await submit(t, "2026-09-02 10:00:00");
    await prize(sem, t, "2026-09-02 20:00:00");

    expect(await leaguePoints(ana.id, SEM)).toEqual({ points: 160, entrega: 1, premio: 1, semanas: 0 });
    expect(leagueBreakdown(await leaguePoints(ana.id, SEM))).toEqual([
      { label: "1 entrega travada", points: 60 },
      { label: "1 prêmio", points: 100 },
    ]);
  });

  it("fato de outro semestre fica de fora da conta", async () => {
    const { past } = await setup();
    const beto = await member();
    await checkin(beto.id, past, "2025-03-01 12:00:00");
    const t = await team(past, [beto.username]);
    await submit(t, "2025-03-02 10:00:00");
    await prize(past, t, "2025-03-02 20:00:00");

    expect((await leaguePoints(beto.id, SEM)).points).toBe(0);
    // a edição de março/2025 é da temporada mar–jul 2025
    expect((await leaguePoints(beto.id, semester(new Date("2025-06-01T12:00:00Z")))).points).toBe(160);
  });

  it("organizador não pontua na própria edição", async () => {
    const { sem } = await setup();
    const org = await member();
    await role(sem, org.id, "organizador");
    await checkin(org.id, sem);
    const t = await team(sem, [org.username]);
    await submit(t, "2026-09-02 10:00:00");
    await prize(sem, t, "2026-09-02 20:00:00");
    expect((await leaguePoints(org.id, SEM)).points).toBe(0);
  });

  it("quem não tem fato nenhum tem 0 ponto", async () => {
    const novo = await member();
    expect(await leaguePoints(novo.id, SEM)).toEqual({ points: 0, entrega: 0, premio: 0, semanas: 0 });
  });

  it("a conta em lote (distribuição) bate com countFacts, pessoa por pessoa", async () => {
    const { sem } = await setup();
    const carla = await member();
    await checkin(carla.id, sem);
    const t = await team(sem, [carla.username]);
    await submit(t, "2026-09-02 11:00:00");

    const dist = await leagueDistribution(SEM);
    const propria = await leaguePoints(carla.id, SEM);
    expect(dist.get(carla.id)).toBe(propria.points);
    expect(propria.points).toBe(60);
  });

  it("a faixa da pessoa sai da distribuição do semestre, sem posição numérica", async () => {
    const { sem } = await setup();
    const dora = await member();
    await checkin(dora.id, sem);
    const t = await team(sem, [dora.username]);
    await submit(t, "2026-09-02 11:00:00");
    await prize(sem, t, "2026-09-02 21:00:00");

    const st = await leagueStanding(dora.id, SEM);
    expect(st.points).toBe(160);
    expect(["top 10%", "top 25%", "top 50%", "começando"]).toContain(st.band);
    expect(st.peers).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(st)).not.toMatch(/#\d/);
  });
});

describe("lista opt-in", () => {
  it("só quem ativou e tem ponto aparece; quem não ativou continua com a própria faixa", async () => {
    const { sem } = await setup();
    const ana = await member("op");
    const beto = await member("op");
    const caio = await member("op");
    for (const m of [ana, beto, caio]) {
      await checkin(m.id, sem);
      const t = await team(sem, [m.username]);
      await submit(t, "2026-09-02 12:00:00");
    }
    await setLeagueOptIn(ana.id, true);
    await setLeagueOptIn(beto.id, true);
    // caio tem ponto e não ativou; e há quem ativou sem ponto
    const semPonto = await member("op");
    await setLeagueOptIn(semPonto.id, true);

    const list = await rankingOptIn(SEM);
    const ids = list.map((r) => r.id);
    expect(ids).toContain(ana.id);
    expect(ids).toContain(beto.id);
    expect(ids).not.toContain(caio.id);
    expect(ids).not.toContain(semPonto.id);
    expect(list.every((r) => !("#" in r) && typeof r.band === "string")).toBe(true);

    // a faixa de quem não ativou aparece pra ela mesma
    expect((await leagueStanding(caio.id, SEM)).points).toBe(60);
    expect(await leagueOptIn(caio.id)).toBe(false);
  });

  it("o opt-in é reversível", async () => {
    const m = await member("op");
    expect(await leagueOptIn(m.id)).toBe(false);
    expect(await setLeagueOptIn(m.id, true)).toBe(true);
    expect(await leagueOptIn(m.id)).toBe(true);
    expect(await setLeagueOptIn(m.id, false)).toBe(false);
    expect(await leagueOptIn(m.id)).toBe(false);
  });

  it("filtro por comunidade mostra só quem é de lá", async () => {
    const { sem } = await setup();
    const ana = await member("cm");
    const beto = await member("cm");
    for (const m of [ana, beto]) {
      await checkin(m.id, sem);
      const t = await team(sem, [m.username]);
      await submit(t, "2026-09-02 13:00:00");
      await setLeagueOptIn(m.id, true);
    }
    const dono = await member("cm");
    const c = await db
      .prepare("INSERT INTO communities (slug, name, createdBy) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(`liga-cm-${seq++}`, "Comunidade Liga", dono.id);
    await db
      .prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'membro')")
      .run(c!.id, ana.id);

    const daComunidade = await rankingOptIn(SEM, { communityId: c!.id });
    expect(daComunidade.map((r) => r.id)).toEqual([ana.id]);
  });

  it("quem lê não vê quem o bloqueou", async () => {
    const { sem } = await setup();
    const ana = await member("bl");
    const beto = await member("bl");
    for (const m of [ana, beto]) {
      await checkin(m.id, sem);
      const t = await team(sem, [m.username]);
      await submit(t, "2026-09-02 14:00:00");
      await setLeagueOptIn(m.id, true);
    }
    await db.prepare("INSERT INTO member_blocks (memberId, blockedId) VALUES (?, ?)").run(beto.id, ana.id);

    const list = await rankingOptIn(SEM, { viewerId: ana.id });
    expect(list.map((r) => r.id)).not.toContain(beto.id);
    expect(list.map((r) => r.id)).toContain(ana.id);
  });

  it("a lista para em 50 nomes", () => {
    expect(LEAGUE_LIST_MAX).toBe(50);
  });
});

describe("flag", () => {
  it("só 'on' liga a liga", () => {
    expect(ligaEnabled({})).toBe(false);
    expect(ligaEnabled({ HACKAHUB_LIGA_ON: "" })).toBe(false);
    expect(ligaEnabled({ HACKAHUB_LIGA_ON: "1" })).toBe(false);
    expect(ligaEnabled({ HACKAHUB_LIGA_ON: "on" })).toBe(true);
  });
});
