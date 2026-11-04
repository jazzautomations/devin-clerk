import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  MAX_OPEN_OPENINGS,
  OPENING_INTRO_MAX,
  activityEditions,
  createOpening,
  matchReasons,
  openAreasOfMyTeams,
} from "@/lib/teamOpenings";

// Compatibilidade em FRASES (spec 046, onda 3): a vaga nunca mostra nota,
// porcentagem ou posição — só o porquê em uma frase, no máximo três.

const H = "vagas-unit-jam";
const PAST = "vagas-unit-passado";
let seq = 0;

type M = { id: number; username: string };

async function member(extra: Record<string, unknown> = {}): Promise<M> {
  const tag = `vu${seq++}`;
  const cols = Object.keys(extra);
  const row = await db
    .prepare(
      `INSERT INTO members ("clerkId", username, email, name${cols.length ? `, ${cols.map((c) => `"${c}"`).join(", ")}` : ""})
       VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")}) RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, ...Object.values(extra));
  return { id: row!.id, username: `u_${tag}` };
}

async function team(hackathonId: string, people: M[]): Promise<number> {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const p of people) {
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, p.username);
  }
  return t!.id;
}

beforeEach(async () => {
  await db.prepare("DELETE FROM team_openings").run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'Vagas Unit', 'HackaHub Teste', '2027-05-01T09:00:00-03:00', '2027-05-02T18:00:00-03:00',
               'presencial', 'https://t.dev/unit', '[]', 1, 'painel')`,
    )
    .run(H);
});

describe("constantes da vaga", () => {
  it("intro até 280 e até 3 vagas abertas por time", () => {
    expect(OPENING_INTRO_MAX).toBe(280);
    expect(MAX_OPEN_OPENINGS).toBe(3);
  });
});

describe("matchReasons", () => {
  it("frase da área vem primeiro e nunca há nota numérica", async () => {
    const ana = await member();
    const bia = await member({ helpOffer: '["design","dev"]' });
    const teamId = await team(H, [ana]);

    const reasons = await matchReasons(bia.id, { area: "design", teamId, hackathonId: H });
    expect(reasons[0]).toBe("oferece design, que é o que a vaga pede");
    expect(reasons.length).toBeLessThanOrEqual(3);
    for (const r of reasons) {
      expect(r).not.toMatch(/\d+(\.\d+)?\s*(%|de compatibilidade)/);
      expect(r).not.toMatch(/nota|score|ranking/i);
    }
  });

  it("mesma comunidade entra como frase; área diferente não entra", async () => {
    const ana = await member();
    const bia = await member();
    const teamId = await team(H, [ana]);
    const c = await db
      .prepare("INSERT INTO communities (slug, name, createdBy) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(`com-${seq++}`, "Comunidade Teste", ana.id);
    for (const m of [ana, bia]) {
      await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(c!.id, m.id);
    }
    const reasons = await matchReasons(bia.id, { area: "design", teamId, hackathonId: H });
    expect(reasons).toContain("vocês são da mesma comunidade (Comunidade Teste)");

    const semArea = await matchReasons(bia.id, { area: "dados", teamId, hackathonId: H });
    expect(semArea.some((r) => r.startsWith("oferece dados"))).toBe(false);
  });

  it("quem já entregou projeto ganha a frase de entrega", async () => {
    const ana = await member();
    const bia = await member();
    const teamId = await team(H, [ana]);
    await db
      .prepare(
        `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'Vagas Unit Passado', 'HackaHub Teste', '2026-01-10T09:00:00-03:00', '2026-01-11T18:00:00-03:00',
                 'presencial', 'https://t.dev/unit-past', '[]', 1, 'painel')`,
      )
      .run(PAST);
    // edição elegível: 15 check-ins distintos; entrega conta em edição encerrada
    for (let i = 0; i < 15; i++) {
      const p = await member();
      const r = await db
        .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
        .get<{ id: number }>(p.id, PAST);
      await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
    }
    const comEntrega = await team(PAST, [bia]);
    await db
      .prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')")
      .run(comEntrega);

    const reasons = await matchReasons(bia.id, { area: "produto", teamId, hackathonId: H });
    expect(reasons).toContain("já entregou 1 projeto");
  });
});

describe("helpers de lista", () => {
  it("openAreasOfMyTeams só devolve área de vaga aberta; activityEditions lista a edição", async () => {
    const ana = await member();
    await team(H, [ana]);
    const vaga = await createOpening(ana, { hackathonId: H, area: "dados", intro: "procuro dados" });
    expect(await openAreasOfMyTeams(ana.username)).toEqual(["dados"]);
    expect((await activityEditions()).map((e) => e.id)).toContain(H);
    await db.prepare("UPDATE team_openings SET status = 'fechada' WHERE id = ?").run(vaga.id);
    expect(await openAreasOfMyTeams(ana.username)).toEqual([]);
    expect((await activityEditions()).map((e) => e.id)).not.toContain(H);
  });
});
