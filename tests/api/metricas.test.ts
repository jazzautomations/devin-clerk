import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import db from "@/lib/db";
import {
  activeWeek,
  canSeeMetrics,
  columnExists,
  formatAvg,
  formatHours,
  formatPct,
  getNetworkMetrics,
  medianResolutionHours,
  metricWeeks,
  openReportsAt,
  postsWeek,
  publicProfileShare,
  relationExists,
  retentionWeek,
  testimonialCoverage,
} from "@/lib/metrics";

// Painel de métricas da rede (spec 046, metricas-e-checkpoint). Cada número
// é conferido contra uma contagem feita à mão sobre as fixtures abaixo, num
// "agora" fixo em 2031 (longe do seed, que vive em 2026).
//
// agora = quarta 12/03/2031 12:00 em Brasília (15:00Z). Semanas (seg 00:00 BRT = 03:00Z):
//   W0 17/02  W1 24/02  W2 03/03  W3 10/03 (parcial, até agora)

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const NOW = new Date("2031-03-12T15:00:00Z");

// Depoimento (migration 037) e perfil aberto (041) chegam em branches
// paralelas. O teste não cria schema (AGENTS.md): com a migration no banco,
// confere os números; sem ela, metricas-sem-feature.test.ts confere o null.
const HAS_TESTIMONIALS = await relationExists("team_testimonials");
const HAS_PUBLIC_PROFILE = await columnExists("members", "publicProfile");
const W = metricWeeks(NOW);

let seq = 0;
async function member(opts: { lastSeenAt?: string | null; role?: string; deleted?: boolean } = {}) {
  const tag = `mt${seq++}`;
  const clerkId = opts.deleted ? `deleted:${tag}` : `clerk_${tag}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email, role, lastSeenAt) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(clerkId, `u_${tag}`, `${tag}@t.dev`, opts.role ?? "member", opts.lastSeenAt ?? null);
  return { id: r!.id, username: `u_${tag}`, clerkId };
}
type M = Awaited<ReturnType<typeof member>>;

async function post(by: M, createdAt: string) {
  const r = await db
    .prepare("INSERT INTO posts (memberId, body, createdAt) VALUES (?, 'oi', ?) RETURNING id")
    .get<{ id: number }>(by.id, createdAt);
  return r!.id;
}
const comment = (postId: number, by: M, createdAt: string) =>
  db.prepare("INSERT INTO post_comments (postId, memberId, body, createdAt) VALUES (?, ?, 'boa', ?)").run(postId, by.id, createdAt);
const react = (postId: number, by: M, kind: string) =>
  db.prepare("INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, ?)").run(postId, by.id, kind);
const follow = (a: M, b: M, createdAt: string) =>
  db.prepare("INSERT INTO member_follows (memberId, followedId, createdAt) VALUES (?, ?, ?)").run(a.id, b.id, createdAt);

async function edition(id: string, endsAt: string) {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel')`,
    )
    .run(id, `Edição ${id}`, endsAt, endsAt);
}
async function checkin(m: M, hackathonId: string) {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(m.id, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
}
async function team(hackathonId: string, name: string, people: M[]) {
  const r = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, name);
  for (const p of people) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(r!.id, p.username);
  return r!.id;
}
const BODY = "Fez o back inteiro em uma noite e ainda explicou pra todo mundo como subir.";
const testimonial = (to: M, from: M, hackathonId: string, teamId: number | null, status: string) =>
  db
    .prepare("INSERT INTO team_testimonials (memberId, authorId, hackathonId, teamId, body, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run(to.id, from.id, hackathonId, teamId, BODY, status);
async function report(opts: { createdAt: string; resolvedAt?: string; communityId?: number; hackathonId?: string }) {
  await db
    .prepare(
      `INSERT INTO reports (targetType, targetId, reason, communityId, hackathonId, createdAt, resolvedAt)
       VALUES ('post', ?, 'motivo de teste', ?, ?, ?, ?)`,
    )
    .run(`t${seq++}`, opts.communityId ?? null, opts.hackathonId ?? null, opts.createdAt, opts.resolvedAt ?? null);
}

let A: M, B: M, C: M, D: M, E: M;
let T1: number;

beforeAll(async () => {
  A = await member({ lastSeenAt: "2031-03-11 10:00:00" }); // W3
  B = await member({ lastSeenAt: "2031-03-10 02:59:59" }); // domingo 23:59:59 BRT → W2
  C = await member({ lastSeenAt: "2031-03-10 03:00:00" }); // segunda 00:00 BRT → W3
  D = await member({ lastSeenAt: "2031-01-01 10:00:00" }); // fora da janela
  E = await member({ lastSeenAt: "2031-03-11 10:00:00", deleted: true }); // conta excluída
  await member(); // nunca entrou

  await follow(A, B, "2031-03-01 12:00:00"); // W1: A ativo em W1 por seguir
  await follow(C, A, "2031-03-11 12:00:00"); // W3: C só segue alguém a partir de W3

  const P1 = await post(B, "2031-03-05 12:00:00"); // W2
  const P2 = await post(D, "2031-02-18 12:00:00"); // W0
  await post(D, "2031-02-19 12:00:00"); // W0, sem nada
  await comment(P1, C, "2031-03-06 12:00:00"); // C ativo em W2; P1 com resposta
  await comment(P2, D, "2031-02-18 13:00:00"); // autor respondendo sozinho não conta
  await react(P1, A, "curti");
  await react(P1, C, "ajudou");
  await react(P1, D, "aprendi");
  await react(P2, B, "curti");

  // edições: H1 acabou em W0 (já passou 14 dias), H2 em W2 (ainda não),
  // H3 em 2030 (fora dos 60 dias do depoimento)
  await edition("mt-h1", "2031-02-18T21:00:00-03:00");
  await edition("mt-h2", "2031-03-04T18:00:00-03:00");
  await edition("mt-h3", "2030-12-01T18:00:00-03:00");
  await checkin(A, "mt-h1"); // voltou (lastSeenAt 11/03 ≥ 05/03)
  await checkin(D, "mt-h1"); // não voltou
  await checkin(C, "mt-h2"); // H2 ainda não completou 14 dias
  // fez check-in na H1 e depois excluiu a conta: privacy.ts guarda o
  // check-in da edição encerrada e zera o lastSeenAt. Não entra na conta.
  const F = await member({ deleted: true });
  await checkin(F, "mt-h1");

  T1 = await team("mt-h1", "Time 1", [A, D]);
  await team("mt-h1", "Time 2", [B]);
  await team("mt-h2", "Time 3", [C]);
  await team("mt-h2", "Time vazio", []); // sem gente: fora da conta
  const T5 = await team("mt-h3", "Time antigo", [B]);
  if (HAS_TESTIMONIALS) {
    await testimonial(A, D, "mt-h1", T1, "aceito"); // T1 escrito e aceito
    await testimonial(B, A, "mt-h1", null, "pendente"); // T2 escrito, casa pelo time da pessoa na edição
    await testimonial(C, A, "mt-h1", null, "aceito"); // C não tem time na H1: não conta pra ninguém
    await testimonial(B, C, "mt-h3", T5, "aceito"); // edição antiga: fora
  }

  const c = await db.prepare("INSERT INTO communities (slug, name) VALUES ('mt-com', 'Com') RETURNING id").get<{ id: number }>();
  await report({ createdAt: "2031-02-20 10:00:00", resolvedAt: "2031-02-20 12:00:00" }); // global, 2 h em W0
  await report({ createdAt: "2031-02-25 10:00:00" }); // global, aberta até hoje
  await report({ createdAt: "2031-03-04 00:00:00", resolvedAt: "2031-03-11 04:00:00", communityId: c!.id }); // 172 h, resolvida em W3
  await report({ createdAt: "2031-03-11 00:00:00", resolvedAt: "2031-03-11 10:00:00", hackathonId: "mt-h2" }); // 10 h em W3
  await report({ createdAt: "2031-03-12 10:00:00", hackathonId: "mt-h2" }); // edição, aberta agora
  await report({ createdAt: "2031-03-12 16:00:00" }); // depois de "agora": não entra

  if (HAS_PUBLIC_PROFILE) {
    await db.prepare("UPDATE members SET publicProfile = 0").run();
    await db.prepare("UPDATE members SET publicProfile = 1 WHERE id IN (?, ?, ?)").run(A.id, B.id, E.id);
  }
});

describe("semanas da janela", () => {
  it("4 semanas de segunda a domingo em Brasília, da mais antiga pra atual", () => {
    expect(W.map((w) => w.label)).toEqual(["17/02", "24/02", "03/03", "10/03"]);
    expect(W[3]).toMatchObject({ start: "2031-03-10T03:00:00.000Z", end: "2031-03-17T03:00:00.000Z", partial: true });
    expect(W.slice(0, 3).every((w) => !w.partial)).toBe(true);
  });

  it("domingo 23:59 em Brasília ainda é a semana que começou na segunda anterior", () => {
    const sun = metricWeeks(new Date("2031-03-10T02:59:00Z"), 1);
    expect(sun[0].label).toBe("03/03");
    const mon = metricWeeks(new Date("2031-03-10T03:00:00Z"), 1);
    expect(mon[0].label).toBe("10/03");
  });
});

describe("cada métrica bate com a contagem manual", () => {
  it("ativos na semana e quantos seguem alguém", async () => {
    const r = await Promise.all(W.map(activeWeek));
    expect(r.map((x) => x.active)).toEqual([1, 1, 2, 2]);
    expect(r.map((x) => [x.following.num, x.following.den])).toEqual([
      [0, 1],
      [1, 1],
      [0, 2],
      [2, 2],
    ]);
    expect(r[3].following.pct).toBe(1);
  });

  it("posts, posts com resposta de outra pessoa e reações", async () => {
    const r = await Promise.all(W.map(postsWeek));
    expect(r.map((x) => x.posts)).toEqual([2, 0, 1, 0]);
    expect(r.map((x) => x.commented.num)).toEqual([0, 0, 1, 0]);
    expect(r.map((x) => x.reactions)).toEqual([1, 0, 3, 0]);
    expect(r.map((x) => x.reactionsPerPost)).toEqual([0.5, null, 3, null]);
    expect(r[2].otherReactions).toEqual({ num: 2, den: 3, pct: 2 / 3 });
    expect(r[0].otherReactions).toEqual({ num: 0, den: 1, pct: 0 });
    expect(r[1].otherReactions.pct).toBeNull();
  });

  it("denúncias abertas por fila no fim de cada semana (a atual até agora)", async () => {
    const ends = [W[0].end, W[1].end, W[2].end, NOW.toISOString()];
    const r = await Promise.all(ends.map(openReportsAt));
    expect(r).toEqual([
      { global: 0, comunidade: 0, edicao: 0 },
      { global: 1, comunidade: 0, edicao: 0 },
      { global: 1, comunidade: 1, edicao: 0 },
      { global: 1, comunidade: 0, edicao: 1 },
    ]);
  });

  it("tempo mediano até resolver, nas resolvidas da semana", async () => {
    const r = await Promise.all(W.map(medianResolutionHours));
    expect(r.map((x) => x.resolved)).toEqual([1, 0, 0, 2]);
    expect(r[0].hours).toBeCloseTo(2);
    expect(r[1].hours).toBeNull();
    expect(r[3].hours).toBeCloseTo(91); // mediana de 172 h e 10 h
  });

  it("volta em 14 dias: só edição que já completou os 14 dias, sem conta excluída", async () => {
    const r = await Promise.all(W.map((w) => retentionWeek(w, NOW)));
    expect(r[0]).toEqual({ num: 1, den: 2, pct: 0.5 }); // A e D; F excluiu a conta
    expect(r[1]).toBeNull(); // nenhuma edição terminou
    expect(r[2]).toBeNull(); // H2 terminou há 8 dias
    expect(r[3]).toBeNull();
  });

  it.skipIf(!HAS_TESTIMONIALS)("times com depoimento: escrito e aceito, edições dos últimos 60 dias", async () => {
    const r = await testimonialCoverage(NOW);
    expect(r).toEqual({
      teams: 3,
      written: { num: 2, den: 3, pct: 2 / 3 },
      accepted: { num: 1, den: 3, pct: 1 / 3 },
    });
  });

  it.skipIf(!HAS_PUBLIC_PROFILE)("perfil aberto entre as contas não excluídas", async () => {
    const den = (await db.prepare("SELECT COUNT(*)::int AS n FROM members WHERE clerkId NOT LIKE 'deleted:%'").get<{ n: number }>())!.n;
    expect(await publicProfileShare()).toEqual({ num: 2, den, pct: 2 / den });
  });

  it("getNetworkMetrics junta tudo na mesma janela", async () => {
    const m = await getNetworkMetrics({ now: NOW });
    expect(m.weeks).toEqual(W);
    expect(m.active).toEqual([1, 1, 2, 2]);
    expect(m.following[3]).toEqual({ num: 2, den: 2, pct: 1 });
    expect(m.posts.map((p) => p.posts)).toEqual([2, 0, 1, 0]);
    expect(m.openReports[3]).toEqual({ global: 1, comunidade: 0, edicao: 1 });
    expect(m.resolution[3].resolved).toBe(2);
    expect(m.retention[0]?.pct).toBe(0.5);
    expect(m.testimonials?.written.num ?? null).toBe(HAS_TESTIMONIALS ? 2 : null);
    expect(m.publicProfile?.num ?? null).toBe(HAS_PUBLIC_PROFILE ? 2 : null);
  });

  it("presença de tabela e coluna", async () => {
    expect(await relationExists("tabela_que_nao_existe")).toBe(false);
    expect(await relationExists("posts")).toBe(true);
    expect(await columnExists("members", "coluna_que_nao_existe")).toBe(false);
    expect(await columnExists("members", "lastSeenAt")).toBe(true);
  });
});

describe("formato", () => {
  it("porcentagem, horas e média", () => {
    expect(formatPct({ num: 1, den: 3, pct: 1 / 3 })).toBe("33%");
    expect(formatPct({ num: 0, den: 0, pct: null })).toBe("—");
    expect(formatPct(null)).toBe("—");
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.25)).toBe("15 min");
    expect(formatHours(10)).toBe("10,0 h");
    expect(formatHours(91)).toBe("3,8 d");
    expect(formatAvg(null)).toBe("—");
    expect(formatAvg(0.5)).toBe("0,5");
  });
});

describe("acesso ao /admin/metricas", () => {
  it("só o admin global", () => {
    expect(canSeeMetrics({ role: "admin" })).toBe(true);
    expect(canSeeMetrics({ role: "member" })).toBe(false);
    expect(canSeeMetrics(null)).toBe(false);
  });

  async function page() {
    const { default: MetricasPage } = await import("@/app/admin/metricas/page");
    return MetricasPage();
  }

  it("deslogado leva 404", async () => {
    clerk.uid = null;
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("membro comum leva 404", async () => {
    clerk.uid = A.clerkId;
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("admin vê o checkpoint e as tabelas", async () => {
    const admin = await member({ role: "admin" });
    clerk.uid = admin.clerkId;
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("checkpoint da onda 3");
    expect(html).toContain("A Onda 3 começa quando o fundador olhar estes números depois da próxima edição.");
    expect(html).toContain('data-testid="checkpoint-wau"');
    expect(html).toContain('data-testid="metric-ativos"');
    expect(html).toContain("meta 30%");
    expect(html).not.toMatch(/orkut|quebra-gelo/i);
  });
});
