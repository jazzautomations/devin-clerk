import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { DUVIDA_MAX_PER_EDITION, EVIDENCE_MIN_CHECKINS } from "@/lib/evidence";
import { BADGES, FACT_XP, XP, factLabel, levelFor } from "@/lib/game";
import { awardXp, checkBadges, computeXp, getMemberBadges, recomputeAll, recomputeXp } from "@/lib/xp";

// Nível por entrega (spec 046, nivel-por-entrega): members.xp vem dos fatos
// verificados de lib/evidence.ts, nunca de post, comentário, curtida ou
// inscrição. Migration 035 guarda o xp antigo em xpLegado.

let seq = 0;
async function member(tag = "xf"): Promise<{ id: number; username: string }> {
  const t = `${tag}${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`, `Pessoa ${t}`);
  return { id: r!.id, username: `u_${t}` };
}

async function edition(startsAt = "2025-03-01T09:00:00-03:00", endsAt = "2025-03-02T18:00:00-03:00"): Promise<string> {
  const id = `xf-ed-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source, publishedAt)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel', '2025-01-01 00:00:00')`,
    )
    .run(id, `Hack ${id}`, startsAt, endsAt);
  return id;
}

async function checkin(memberId: number, hackathonId: string, at = "2025-03-01 12:00:00") {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(memberId, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, ?)").run(r!.id, at);
}

/** edição elegível: 15 check-ins de outras pessoas */
async function eligible(startsAt?: string, endsAt?: string): Promise<string> {
  const h = await edition(startsAt, endsAt);
  for (let i = 0; i < EVIDENCE_MIN_CHECKINS; i++) await checkin((await member("pl")).id, h);
  return h;
}

async function team(hackathonId: string, usernames: string[]): Promise<number> {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  return t!.id;
}

async function submit(teamId: number) {
  await db
    .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, 1, '{}', '2025-03-02 10:00:00')")
    .run(teamId);
}

async function prize(hackathonId: string, teamId: number) {
  const c = await db
    .prepare("INSERT INTO prize_categories (hackathonId, kind, name) VALUES (?, 'geral', 'Geral') RETURNING id")
    .get<{ id: number }>(hackathonId);
  await db
    .prepare("INSERT INTO prize_winners (categoryId, teamId, place, createdAt) VALUES (?, ?, 1, '2025-03-02 20:00:00')")
    .run(c!.id, teamId);
}

const role = (h: string, m: number, r: string) =>
  db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, ?)").run(h, m, r);

const xpOf = async (id: number) =>
  (await db.prepare(`SELECT xp, "xpLegado" FROM members WHERE id = ?`).get<{ xp: number; xpLegado: number | null }>(id))!;

describe("FACT_XP e níveis", () => {
  it("valores da spec e rótulo no singular e no plural", () => {
    expect(Object.fromEntries(Object.entries(FACT_XP).map(([k, v]) => [k, v.xp]))).toEqual({
      presenca: 30,
      entrega: 60,
      premio: 100,
      voltou: 20,
      mentoria: 40,
      organizou: 80,
      duvida: 5,
    });
    expect(factLabel("presenca", 1)).toBe("1 presença");
    expect(factLabel("presenca", 2)).toBe("2 presenças");
    expect(factLabel("entrega", 1)).toBe("1 entrega travada");
    expect(factLabel("organizou", 3)).toBe("3 edições organizadas");
  });

  it("XP por ação zerado (post, comentário, curtida, inscrição, time)", () => {
    expect(Object.values(XP).every((v) => v === 0)).toBe(true);
  });

  it("a conta documentada: 1 edição com presença e entrega = hacker; a segunda = veterano", () => {
    const uma = FACT_XP.presenca.xp + FACT_XP.entrega.xp;
    expect(uma).toBe(90);
    expect(levelFor(uma).level.name).toBe("hacker");
    const duas = uma + FACT_XP.presenca.xp + FACT_XP.voltou.xp + FACT_XP.entrega.xp;
    expect(duas).toBe(200);
    expect(levelFor(duas).level.name).toBe("veterano");
  });

  it("criador e influente estão aposentadas", () => {
    expect(BADGES.criador.retired).toBe(true);
    expect(BADGES.influente.retired).toBe(true);
    expect(BADGES.pioneiro.retired).toBeUndefined();
  });
});

describe("computeXp", () => {
  it("sem fato: total 0 e lista vazia", async () => {
    const ana = await member();
    expect(await computeXp(ana.id)).toEqual({ total: 0, facts: [] });
  });

  it("check-in, entrega travada e prêmio em edição elegível = 190 (aceite 1)", async () => {
    const h = await eligible();
    const ana = await member();
    await checkin(ana.id, h);
    const t = await team(h, [ana.username]);
    await submit(t);
    await prize(h, t);
    const b = await computeXp(ana.id);
    expect(b.total).toBe(190);
    expect(b.facts).toEqual([
      { kind: "presenca", label: "1 presença", count: 1, xp: 30 },
      { kind: "entrega", label: "1 entrega travada", count: 1, xp: 60 },
      { kind: "premio", label: "1 prêmio", count: 1, xp: 100 },
    ]);
    await recomputeXp(ana.id);
    expect((await xpOf(ana.id)).xp).toBe(190);
  });

  it("edição com menos de 15 check-ins não dá xp", async () => {
    const h = await edition();
    const ana = await member();
    await checkin(ana.id, h);
    const t = await team(h, [ana.username]);
    await submit(t);
    await prize(h, t);
    expect((await computeXp(ana.id)).total).toBe(0);
  });

  it("mentoria 40, organização 80 (e organizador não ganha presença nem prêmio)", async () => {
    const h = await eligible();
    const mentora = await member();
    await role(h, mentora.id, "mentor");
    expect((await computeXp(mentora.id)).facts).toEqual([{ kind: "mentoria", label: "1 mentoria", count: 1, xp: 40 }]);

    const org = await member();
    await role(h, org.id, "organizador");
    await checkin(org.id, h);
    const t = await team(h, [org.username]);
    await submit(t);
    await prize(h, t);
    expect(await computeXp(org.id)).toEqual({
      total: 80,
      facts: [{ kind: "organizou", label: "1 edição organizada", count: 1, xp: 80 }],
    });
  });

  it(`dúvida vale 5 e para em ${DUVIDA_MAX_PER_EDITION} por edição`, async () => {
    const h = await eligible();
    const ana = await member();
    const quem = await member();
    for (let i = 0; i < DUVIDA_MAX_PER_EDITION + 4; i++) {
      const q = await db
        .prepare("INSERT INTO questions (hackathonId, memberId, body, resolvedAt) VALUES (?, ?, 'como?', '2025-03-01 15:00:00') RETURNING id")
        .get<{ id: number }>(h, quem.id);
      await db.prepare("INSERT INTO answers (questionId, memberId, body) VALUES (?, ?, 'assim')").run(q!.id, ana.id);
    }
    const b = await computeXp(ana.id);
    expect(b.facts).toEqual([
      { kind: "duvida", label: `${DUVIDA_MAX_PER_EDITION} dúvidas respondidas`, count: DUVIDA_MAX_PER_EDITION, xp: 50 },
    ]);
    expect(b.total).toBe(DUVIDA_MAX_PER_EDITION * 5);
  });

  it("voltou soma 20 por edição além da primeira; since recorta", async () => {
    const h1 = await eligible("2024-03-01T09:00:00-03:00", "2024-03-02T18:00:00-03:00");
    const h2 = await eligible("2025-09-01T09:00:00-03:00", "2025-09-02T18:00:00-03:00");
    const ana = await member();
    await checkin(ana.id, h1, "2024-03-01 12:00:00");
    await checkin(ana.id, h2, "2025-09-01 12:00:00");
    const tudo = await computeXp(ana.id);
    expect(tudo.total).toBe(30 + 30 + 20);
    expect(tudo.facts.map((f) => f.label)).toEqual(["2 presenças", "1 retorno"]);
    const desde2025 = await computeXp(ana.id, { since: "2025-01-01 00:00:00" });
    expect(desde2025.total).toBe(30 + 20);
    const ate2024 = await computeXp(ana.id, { until: new Date("2024-12-31T23:59:59Z") });
    expect(ate2024.total).toBe(30);
  });
});

describe("post, comentário e curtida não dão xp (aceite 2)", () => {
  it("100 posts, 100 curtidas e inscrição não mudam o xp; criador e influente não saem mais", async () => {
    const ana = await member();
    const h = await eligible();
    await checkin(ana.id, h);
    await recomputeXp(ana.id);
    expect((await xpOf(ana.id)).xp).toBe(30);

    for (let i = 0; i < 100; i++) {
      const p = await db
        .prepare("INSERT INTO posts (memberId, body) VALUES (?, ?) RETURNING id")
        .get<{ id: number }>(ana.id, `post ${i}`);
      await db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(p!.id, (await member("lk")).id);
      // o que as rotas antigas ainda chamam
      await awardXp(ana.id, XP.post);
      await awardXp(ana.id, XP.likeReceived);
      await awardXp(ana.id, XP.comment);
    }
    await awardXp(ana.id, XP.register);
    expect((await xpOf(ana.id)).xp).toBe(30);
    expect((await computeXp(ana.id)).total).toBe(30);

    const novas = (await checkBadges(ana.id)).map((b) => b.id);
    expect(novas).not.toContain("criador");
    expect(novas).not.toContain("influente");
  });

  it("valor somado por fora some no recompute", async () => {
    const ana = await member();
    await awardXp(ana.id, 500);
    expect((await xpOf(ana.id)).xp).toBe(500);
    const r = await recomputeXp(ana.id);
    expect(r.changed).toBe(true);
    expect((await xpOf(ana.id)).xp).toBe(0);
    expect((await recomputeXp(ana.id)).changed).toBe(false);
  });
});

describe("badges aposentadas", () => {
  it("influente e criador antigos ficam no banco e somem da exibição (aceite 5)", async () => {
    const ana = await member();
    await db.prepare("INSERT INTO member_badges (memberId, badgeId) VALUES (?, 'influente'), (?, 'criador'), (?, 'debut')").run(ana.id, ana.id, ana.id);
    expect((await getMemberBadges(ana.id)).map((b) => b.id)).toEqual(["debut"]);
    const linhas = await db.prepare("SELECT badgeId FROM member_badges WHERE memberId = ?").all(ana.id);
    expect(linhas).toHaveLength(3);
  });
});

describe("recomputeAll", () => {
  it("zera quem não tem fato, grava quem tem e é idempotente (aceite 7)", async () => {
    const h = await eligible();
    const ana = await member();
    const farm = await member();
    await checkin(ana.id, h);
    const t = await team(h, [ana.username]);
    await submit(t);
    await db.prepare("UPDATE members SET xp = 999 WHERE id IN (?, ?)").run(ana.id, farm.id);

    const r1 = await recomputeAll(7); // lote pequeno exercita a paginação
    expect(r1.updated).toBeGreaterThanOrEqual(2);
    expect(r1.scanned).toBeGreaterThan(7);
    expect((await xpOf(ana.id)).xp).toBe(90);
    expect((await xpOf(farm.id)).xp).toBe(0);

    const r2 = await recomputeAll(7);
    expect(r2.updated).toBe(0);
    expect((await xpOf(ana.id)).xp).toBe(90);
  });
});

describe("migration 035", () => {
  const sql = readFileSync(join(process.cwd(), "migrations/035_xp_legado.sql"), "utf8");

  it("xpLegado guarda o xp de antes e rodar de novo não sobrescreve (aceite 3)", async () => {
    const ana = await member();
    await db.prepare(`UPDATE members SET xp = 345, "xpLegado" = NULL WHERE id = ?`).run(ana.id);
    await db.exec(sql);
    expect(await xpOf(ana.id)).toEqual({ xp: 345, xpLegado: 345 });
    await recomputeXp(ana.id);
    await db.exec(sql);
    expect(await xpOf(ana.id)).toEqual({ xp: 0, xpLegado: 345 });
  });
});
