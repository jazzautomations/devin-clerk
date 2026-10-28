import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { revokeEditionRole } from "@/lib/roles";
import {
  DUVIDA_MAX_PER_EDITION,
  EVIDENCE_MIN_CHECKINS,
  FACT_KINDS,
  countFacts,
  eligibleEdition,
  eligibleEditionsSql,
  factsFor,
  sameTeam,
  sharedTeamsLabel,
} from "@/lib/evidence";

// Fonte única de evidência (spec 046, evidencia-e-lgpd): cada fato com
// fixture, os limites antifarm (15 check-ins, organizador da mesma edição,
// comunidade não verificada) e o recorte por data.

const authMock = vi.fn(async () => ({ userId: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));

let seq = 0;
async function member(tag = "ev"): Promise<{ id: number; username: string; tag: string }> {
  const t = `${tag}${seq++}`;
  const r = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${t}`, `u_${t}`, `${t}@t.dev`, `Pessoa ${t}`);
  return { id: r!.id, username: `u_${t}`, tag: t };
}

async function community(verified: number, hidden = 0): Promise<number> {
  const slug = `cm-${seq++}`;
  const r = await db
    .prepare("INSERT INTO communities (slug, name, verified, hidden) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, verified, hidden);
  return r!.id;
}

type EdOpts = {
  communityId?: number | null;
  source?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  submissionDeadline?: string | null;
  publishedAt?: string | null;
};
async function edition(opts: EdOpts = {}): Promise<string> {
  const id = `ed-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source,
         communityId, publishedAt, submissionDeadline)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', 1, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `Hack ${id}`,
      opts.startsAt ?? "2025-03-01T09:00:00-03:00",
      opts.endsAt === undefined ? "2025-03-02T18:00:00-03:00" : opts.endsAt,
      opts.source === undefined ? "painel" : opts.source,
      opts.communityId ?? null,
      opts.publishedAt === undefined ? "2025-01-01 00:00:00" : opts.publishedAt,
      opts.submissionDeadline ?? null,
    );
  return id;
}

async function checkin(memberId: number, hackathonId: string, at = "2025-03-01 12:00:00") {
  const r = await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
    .get<{ id: number }>(memberId, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, ?)").run(r!.id, at);
}

/** n pessoas com check-in (a "plateia" que torna a edição elegível) */
async function crowd(hackathonId: string, n: number) {
  for (let i = 0; i < n; i++) await checkin((await member("pl")).id, hackathonId);
}

async function team(hackathonId: string, usernames: string[]): Promise<number> {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  return t!.id;
}

async function submit(teamId: number, version: number, at = "2025-03-02 10:00:00") {
  await db
    .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, ?, '{}', ?)")
    .run(teamId, version, at);
}

async function prize(hackathonId: string, teamId: number, name: string) {
  const c = await db
    .prepare("INSERT INTO prize_categories (hackathonId, kind, name) VALUES (?, 'geral', ?) RETURNING id")
    .get<{ id: number }>(hackathonId, name);
  await db.prepare("INSERT INTO prize_winners (categoryId, teamId, place, createdAt) VALUES (?, ?, 1, '2025-03-02 20:00:00')").run(c!.id, teamId);
}

async function role(hackathonId: string, memberId: number, r: string) {
  await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, ?)").run(hackathonId, memberId, r);
}

const kinds = async (memberId: number) => (await factsFor(memberId)).map((f) => f.kind);

describe("edição elegível", () => {
  it(`${EVIDENCE_MIN_CHECKINS - 1} check-ins não geram fato; ${EVIDENCE_MIN_CHECKINS} geram`, async () => {
    const h = await edition();
    const ana = await member();
    await checkin(ana.id, h);
    await crowd(h, EVIDENCE_MIN_CHECKINS - 2); // ana + 13 = 14
    expect(await eligibleEdition(h)).toBe(false);
    expect(await factsFor(ana.id)).toEqual([]);
    await crowd(h, 1); // 15
    expect(await eligibleEdition(h)).toBe(true);
    expect(await factsFor(ana.id)).toEqual([{ kind: "presenca", hackathonId: h, at: "2025-03-01 12:00:00" }]);
  });

  it("inscrição não aprovada com check-in não conta pros 15", async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS - 1);
    const x = await member();
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'pending') RETURNING id")
      .get<{ id: number }>(x.id, h);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
    expect(await eligibleEdition(h)).toBe(false);
  });

  it("comunidade não verificada (ou escondida) não gera fato; verificada gera", async () => {
    const solta = await edition({ communityId: await community(0) });
    const escondida = await edition({ communityId: await community(1, 1) });
    const verificada = await edition({ communityId: await community(1) });
    const ana = await member();
    for (const h of [solta, escondida, verificada]) {
      await checkin(ana.id, h);
      await crowd(h, EVIDENCE_MIN_CHECKINS);
    }
    expect(await eligibleEdition(solta)).toBe(false);
    expect(await eligibleEdition(escondida)).toBe(false);
    expect(await eligibleEdition(verificada)).toBe(true);
    expect((await factsFor(ana.id)).map((f) => f.hackathonId)).toEqual([verificada]);
  });

  it("evento externo do radar (não roda no HackaHub) não conta", async () => {
    const h = await edition({ source: "devpost" });
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    expect(await eligibleEdition(h)).toBe(false);
  });

  it("o fragmento SQL serve em subquery", async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const rows = await db.prepare(`SELECT id FROM hackathons WHERE id IN (${eligibleEditionsSql}) AND id = ?`).all(h);
    expect(rows).toHaveLength(1);
  });
});

describe("fatos", () => {
  it("organizador com check-in e prêmio na própria edição: só 'organizou'", async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const org = await member();
    await role(h, org.id, "organizador");
    await checkin(org.id, h);
    const t = await team(h, [org.username]);
    await submit(t, 1);
    await prize(h, t, "Geral");
    expect(await kinds(org.id)).toEqual(["organizou"]);
  });

  it("organizador que perdeu o papel depois do evento continua sem presença, entrega e prêmio", async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const org = await member();
    const alt = await member();
    await role(h, org.id, "organizador");
    await role(h, alt.id, "organizador");
    await checkin(org.id, h);
    const t = await team(h, [org.username]);
    await submit(t, 1);
    await prize(h, t, "Geral");
    // a conta "alt" tira o papel de quem rodou a edição: os fatos não destravam
    const { DELETE } = await import("@/app/api/admin/hackathons/[id]/roles/route");
    authMock.mockResolvedValue({ userId: `clerk_${alt.tag}` });
    const res = await DELETE(
      new Request("http://t", { method: "DELETE", body: JSON.stringify({ memberId: org.id, role: "organizador" }) }),
      { params: Promise.resolve({ id: h }) },
    );
    expect(res.status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM edition_roles WHERE hackathonId = ? AND memberId = ?").get(h, org.id)).toBeFalsy();
    expect(await kinds(org.id)).toEqual([]);
    authMock.mockResolvedValue({ userId: null });
  });

  it("papel de staff tirado não conta como organizador", async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const ana = await member();
    await role(h, ana.id, "staff");
    await revokeEditionRole(h, ana.id, "staff");
    await checkin(ana.id, h);
    expect(await kinds(ana.id)).toEqual(["presenca"]);
  });

  it("organizou só em edição publicada e encerrada", async () => {
    const futura = await edition({ startsAt: "2099-01-01T09:00:00-03:00", endsAt: "2099-01-02T18:00:00-03:00" });
    const org = await member();
    await role(futura, org.id, "organizador");
    await crowd(futura, EVIDENCE_MIN_CHECKINS);
    expect(await kinds(org.id)).toEqual([]);
  });

  it("entrega: 1 por time travado (várias versões), nada com prazo aberto ou reabertura vigente", async () => {
    const h = await edition({ submissionDeadline: "2025-03-02 15:00:00" });
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const ana = await member();
    const t = await team(h, [ana.username]);
    await submit(t, 1, "2025-03-02 10:00:00");
    await submit(t, 2, "2025-03-02 14:00:00");
    expect(await factsFor(ana.id)).toEqual([{ kind: "entrega", hackathonId: h, teamId: t, at: "2025-03-02 14:00:00" }]);

    // time reaberto até o futuro: ainda não travou (edição em andamento)
    const viva = await edition({
      startsAt: "2025-01-01T09:00:00-03:00",
      endsAt: "2099-01-01T09:00:00-03:00",
      submissionDeadline: "2025-01-02 15:00:00",
    });
    await crowd(viva, EVIDENCE_MIN_CHECKINS);
    const bia = await member();
    const tb = await team(viva, [bia.username]);
    await submit(tb, 1);
    await db.prepare("UPDATE teams SET reopenedUntil = '2099-01-01 00:00:00' WHERE id = ?").run(tb);
    expect(await kinds(bia.id)).toEqual([]);
    await db.prepare("UPDATE teams SET reopenedUntil = '2025-01-03 00:00:00' WHERE id = ?").run(tb);
    expect(await kinds(bia.id)).toEqual(["entrega"]);

    // sem prazo e sem versão: nada; sem prazo, edição encerrada e com versão: conta
    const antiga = await edition();
    await crowd(antiga, EVIDENCE_MIN_CHECKINS);
    const caio = await member();
    const tc = await team(antiga, [caio.username]);
    expect(await kinds(caio.id)).toEqual([]);
    await submit(tc, 1);
    expect(await kinds(caio.id)).toEqual(["entrega"]);
  });

  it("prêmio: 1 por categoria", async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const ana = await member();
    const t = await team(h, [ana.username]);
    await prize(h, t, "Geral");
    await prize(h, t, "Desafio X");
    const facts = await factsFor(ana.id);
    expect(facts.filter((f) => f.kind === "premio")).toHaveLength(2);
    expect(facts.every((f) => f.teamId === t)).toBe(true);
  });

  it("mentoria: mentor, jurado ou staff em edição encerrada, 1 por edição", async () => {
    const h = await edition();
    const futura = await edition({ startsAt: "2099-01-01T09:00:00-03:00", endsAt: "2099-01-02T18:00:00-03:00" });
    for (const e of [h, futura]) await crowd(e, EVIDENCE_MIN_CHECKINS);
    const ana = await member();
    await role(h, ana.id, "mentor");
    await role(h, ana.id, "jurado");
    await role(futura, ana.id, "staff");
    const facts = await factsFor(ana.id);
    expect(facts).toEqual([{ kind: "mentoria", hackathonId: h, at: "2025-03-02 21:00:00" }]);
  });

  it(`dúvida: resposta em dúvida resolvida de outra pessoa, até ${DUVIDA_MAX_PER_EDITION} por edição`, async () => {
    const h = await edition();
    await crowd(h, EVIDENCE_MIN_CHECKINS);
    const ana = await member();
    const quem = await member();
    const ask = async (by: number, resolved: boolean) =>
      (await db
        .prepare("INSERT INTO questions (hackathonId, memberId, body, resolvedAt) VALUES (?, ?, 'como?', ?) RETURNING id")
        .get<{ id: number }>(h, by, resolved ? "2025-03-01 15:00:00" : null))!.id;
    const answer = (q: number, by: number) =>
      db.prepare("INSERT INTO answers (questionId, memberId, body) VALUES (?, ?, 'assim')").run(q, by);

    const q1 = await ask(quem.id, true);
    await answer(q1, ana.id);
    await answer(q1, ana.id); // duas respostas na mesma dúvida = 1
    await answer(await ask(quem.id, false), ana.id); // não resolvida
    await answer(await ask(ana.id, true), ana.id); // a própria
    expect(await kinds(ana.id)).toEqual(["duvida"]);

    for (let i = 0; i < 12; i++) await answer(await ask(quem.id, true), ana.id);
    expect((await countFacts(ana.id)).duvida).toBe(DUVIDA_MAX_PER_EDITION);
  });

  it("voltou: cada edição com presença além da primeira; recorte por data", async () => {
    const eds = [
      await edition({ startsAt: "2024-03-01T09:00:00-03:00", endsAt: "2024-03-02T18:00:00-03:00" }),
      await edition({ startsAt: "2025-03-01T09:00:00-03:00", endsAt: "2025-03-02T18:00:00-03:00" }),
      await edition({ startsAt: "2025-09-01T09:00:00-03:00", endsAt: "2025-09-02T18:00:00-03:00" }),
    ];
    const ana = await member();
    const dates = ["2024-03-01 12:00:00", "2025-03-01 12:00:00", "2025-09-01 12:00:00"];
    for (const [i, h] of eds.entries()) {
      await checkin(ana.id, h, dates[i]);
      await crowd(h, EVIDENCE_MIN_CHECKINS);
    }
    const n = await countFacts(ana.id);
    expect(n.presenca).toBe(3);
    expect(n.voltou).toBe(2);
    const voltou = (await factsFor(ana.id)).filter((f) => f.kind === "voltou").map((f) => f.hackathonId);
    expect(voltou).toEqual([eds[1], eds[2]]);

    // recorte: 2025 inteiro tem 2 presenças e 2 "voltou" (a 1ª vinda foi em 2024)
    const ano = await countFacts(ana.id, { since: "2025-01-01 00:00:00", until: new Date("2025-12-31T23:59:59Z") });
    expect(ano.presenca).toBe(2);
    expect(ano.voltou).toBe(2);
    expect((await factsFor(ana.id, { until: "2024-12-31 23:59:59" })).map((f) => f.kind)).toEqual(["presenca"]);
  });

  it("countFacts traz todo tipo, zero quando não há", async () => {
    const ana = await member();
    const n = await countFacts(ana.id);
    expect(Object.keys(n).sort()).toEqual([...FACT_KINDS].sort());
    expect(Object.values(n).every((v) => v === 0)).toBe(true);
  });
});

describe("sameTeam", () => {
  it("edições em que os dois foram do mesmo time e a frase", async () => {
    const ana = await member();
    const bia = await member();
    const caio = await member();
    const h1 = await edition({ startsAt: "2024-03-01T09:00:00-03:00" });
    const h2 = await edition({ startsAt: "2025-03-01T09:00:00-03:00" });
    await team(h1, [ana.username, bia.username]);
    await team(h1, [caio.username]);
    expect(await sameTeam(ana.id, caio.id)).toEqual([]);
    expect(await sharedTeamsLabel(ana.id, caio.id)).toBeNull();
    expect(await sameTeam(ana.id, ana.id)).toEqual([]);

    expect(await sharedTeamsLabel(ana.id, bia.id)).toBe(`vocês fizeram time no Hack ${h1}`);
    await team(h2, [bia.username, ana.username]);
    const both = await sameTeam(bia.id, ana.id);
    expect(both.map((t) => t.hackathonId)).toEqual([h2, h1]);
    expect(await sharedTeamsLabel(ana.id, bia.id)).toBe(`vocês fizeram time no Hack ${h2} e no Hack ${h1}`);
    const h3 = await edition({ startsAt: "2025-09-01T09:00:00-03:00" });
    await team(h3, [bia.username, ana.username]);
    expect(await sharedTeamsLabel(ana.id, bia.id)).toBe(`vocês fizeram time no Hack ${h3} e em mais 2 edições`);
  });
});
