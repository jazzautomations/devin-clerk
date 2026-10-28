import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { submitRegistration } from "@/lib/registrationForm";
import { cancelRegistration, reviewRegistration, unregister } from "@/lib/registrations";
import { memberTeamFor, submitTeam } from "@/lib/teams";
import { listMyInvites, respondInvite } from "@/lib/teamInvites";
import { getBoardEntry, upsertBoardEntry } from "@/lib/teamboard";
import { getEntry, listEntriesForAdmin, saveDraft, submitEntry } from "@/lib/entries";
import { deleteMemberData } from "@/lib/privacy";
import { getRanking, listJuryTeams } from "@/lib/jury";
import { getArchive, getProjectByTeamId } from "@/lib/archive";
import { processRsvp, respondRsvp, rsvpToken } from "@/lib/rsvp";

// Auditoria 041, pacote C: inscrição e cancelamento com regra, time que se
// resolve sem mexer no banco, participante avisado e entrega sem caminho
// escondido.

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
}));

const H = "hack-inova-alphaville-2026"; // começa 2026-11-14 09:00 BRT
const AFTER_START = new Date("2026-11-14T12:30:00Z");
const ctx = (id = H) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const TERMS = { birthDate: "2000-01-01", conduct: true };

async function member(username: string): Promise<{ id: number; username: string }> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`);
  return (await db.prepare("SELECT id, username FROM members WHERE username = ?").get<{ id: number; username: string }>(username))!;
}

const signup = (m: { id: number }, hackathonId = H) =>
  submitRegistration({ memberId: m.id, hackathonId, answers: {}, consent: true, ip: null, terms: TERMS });

const xpOf = async (id: number) => (await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(id))!.xp;
const statusOf = async (id: number, hackathonId = H) =>
  (await db.prepare("SELECT status FROM registrations WHERE memberId = ? AND hackathonId = ?").get<{ status: string }>(id, hackathonId))
    ?.status ?? null;
const notes = async (id: number) =>
  (await db.prepare("SELECT type, text, href FROM notifications WHERE memberId = ? ORDER BY id").all<{ type: string; text: string; href: string }>(id));

beforeEach(async () => {
  for (const t of [
    "rsvp_messages",
    "rsvp_releases",
    "checkins",
    "team_invites",
    "team_members",
    "project_submissions",
    "submission_events",
    "team_projects",
    "scores",
    "rubric_criteria",
    "announcements",
    "teams",
    "looking_for_team",
    "notifications",
    "registration_rewards",
  ]) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare("DELETE FROM registrations").run();
  await db.prepare("DELETE FROM member_cards").run();
  await db
    .prepare(
      "UPDATE hackathons SET capacity = NULL, requiresApproval = 0, registrationDeadline = NULL, submissionDeadline = NULL WHERE id = ?",
    )
    .run(H);
  who = null;
});

describe("recompensa e cancelamento (unregister-sem-regra)", () => {
  it("inscrever → cancelar → inscrever 4× não rende xp e minta uma carta só", async () => {
    const m = await member("farm");
    const before = await xpOf(m.id);
    for (let i = 0; i < 4; i++) {
      const r = await signup(m);
      expect(r.ok).toBe(true);
      await unregister(m.id, H);
    }
    await signup(m);
    expect((await xpOf(m.id)) - before).toBe(0); // XP por inscrição acabou (spec 046)
    const cards = await db.prepare("SELECT COUNT(*)::int AS n FROM member_cards WHERE memberId = ? AND hackathonId = ?").get<{ n: number }>(m.id, H);
    expect(cards!.n).toBe(1);
  });

  it("inscrição recusada não cancela (409) e a linha fica", async () => {
    await db.prepare("UPDATE hackathons SET requiresApproval = 1 WHERE id = ?").run(H);
    const m = await member("recusado");
    await signup(m);
    await reviewRegistration(m.id, H, "reject");
    who = "clerk_recusado";
    const { DELETE } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await DELETE(req("DELETE"), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("rejected");
    expect(await statusOf(m.id)).toBe("rejected");
  });

  it("com check-in feito não cancela (409) e a presença fica", async () => {
    const m = await member("presente");
    await signup(m);
    const reg = await db.prepare("SELECT id FROM registrations WHERE memberId = ?").get<{ id: number }>(m.id);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(reg!.id);
    await expect(cancelRegistration(m.id, H)).rejects.toMatchObject({ code: "checked_in", status: 409 });
    expect(await db.prepare("SELECT 1 FROM checkins WHERE registrationId = ?").get(reg!.id)).toBeTruthy();
  });

  it("depois do início não cancela (409) e ninguém sai da fila", async () => {
    await db.prepare("UPDATE hackathons SET capacity = 1 WHERE id = ?").run(H);
    const a = await member("dentro");
    const b = await member("nafila");
    await signup(a);
    await signup(b);
    expect(await statusOf(b.id)).toBe("waitlist");
    await expect(cancelRegistration(a.id, H, AFTER_START)).rejects.toMatchObject({ code: "event_started" });
    expect(await statusOf(a.id)).toBe("approved");
    expect(await statusOf(b.id)).toBe("waitlist");
  });
});

describe("inscrição fechada (inscricao-edicao-encerrada)", () => {
  async function edition(id: string, cols: { endsAt?: string; registrationDeadline?: string; organizer?: string }) {
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, registrationDeadline, tags, active, source)
         VALUES (?, ?, ?, ?, ?, 'presencial', '/x', ?, '[]', 1, ?) ON CONFLICT (id) DO NOTHING`,
      )
      .run(
        id,
        id,
        cols.organizer ?? "Hack Inova",
        "2026-01-10T09:00:00-03:00",
        cols.endsAt ?? null,
        cols.registrationDeadline ?? null,
        // sem organizador = edição que roda no HackaHub; com outro, evento do radar
        cols.organizer ? "sympla" : "painel",
      );
  }

  it("edição encerrada → 409 e nada é gravado", async () => {
    await edition("pkgc-encerrada", { endsAt: "2026-01-11T18:00:00-03:00" });
    const m = await member("atrasado");
    who = "clerk_atrasado";
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true, terms: TERMS }), ctx("pkgc-encerrada"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("registration_closed");
    expect(await statusOf(m.id, "pkgc-encerrada")).toBeNull();
  });

  it("prazo de inscrição vencido numa edição futura → 409", async () => {
    await db.prepare("UPDATE hackathons SET registrationDeadline = '2026-01-01T23:59:00-03:00' WHERE id = ?").run(H);
    await member("prazo");
    who = "clerk_prazo";
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    expect((await POST(req("POST", { consent: true, terms: TERMS }), ctx())).status).toBe(409);
  });

  it("edição que não é da Hack Inova → 404", async () => {
    await edition("pkgc-radar", { organizer: "Outra Org", endsAt: "2027-01-01" });
    await member("radar");
    who = "clerk_radar";
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    expect((await POST(req("POST", { consent: true, terms: TERMS }), ctx("pkgc-radar"))).status).toBe(404);
  });
});

describe("time sem membro fantasma (time-membro-fantasma-bloqueia-entrega)", () => {
  const full = {
    title: "Mapa",
    tagline: "o mapa",
    description: "## Problema",
    priorWork: "nada",
    technologies: ["Next.js"],
    repoUrl: "https://github.com/t/mapa",
  };

  async function teamOf3() {
    const ana = await member("ana");
    const carla = await member("carla");
    const davi = await member("davi");
    for (const m of [ana, carla, davi]) await signup(m);
    const { team } = await submitTeam(H, ana, { name: "Time Auditoria", memberUsernames: ["carla", "davi"] });
    for (const m of [carla, davi]) {
      const [inv] = await listMyInvites(m.id, H);
      await respondInvite(inv.id, m, "accept");
    }
    await saveDraft(team.id, ana, full);
    return { ana, carla, davi, teamId: team.id };
  }

  it("quem cancela sai do time, o time é avisado e a entrega passa", async () => {
    const { ana, carla, teamId } = await teamOf3();
    await unregister(carla.id, H);
    expect((await getEntry(teamId))!.members).toEqual(["ana", "davi"]);
    expect((await notes(ana.id)).some((n) => n.type === "team_member_left" && n.text.includes("@carla"))).toBe(true);
    const { version } = await submitEntry(teamId, ana);
    expect(version).toBe(1);
  });

  it("recusa do organizador tira do time e avisa a pessoa", async () => {
    const { carla, teamId } = await teamOf3();
    await reviewRegistration(carla.id, H, "reject");
    expect((await getEntry(teamId))!.members).not.toContain("carla");
    expect((await notes(carla.id)).at(-1)).toMatchObject({ type: "registration_rejected", href: "/radar" });
  });

  it("excluir a conta numa edição futura tira a pessoa do time; notas do júri ficam (ranking igual)", async () => {
    const { ana, davi, teamId } = await teamOf3();
    // davi também é jurado de outro time da edição passada? basta uma nota dele
    const crit = await db
      .prepare("INSERT INTO rubric_criteria (hackathonId, label, weight) VALUES (?, 'impacto', 1) RETURNING id")
      .get<{ id: number }>(H);
    await db
      .prepare("INSERT INTO scores (judgeMemberId, teamId, criterionId, score, comment, feedback) VALUES (?, ?, ?, 4, 'ok', 'bom')")
      .run(davi.id, teamId, crit!.id);
    const before = await getRanking(H);
    await deleteMemberData(davi.id);
    expect(await getRanking(H)).toEqual(before);
    expect(await db.prepare("SELECT score, comment, feedback FROM scores WHERE judgeMemberId = ?").all(davi.id)).toEqual([
      { score: 4, comment: null, feedback: null },
    ]);
    const entry = (await getEntry(teamId))!;
    expect(entry.members).toEqual(["ana", "carla"]);
    expect((await submitEntry(teamId, ana)).version).toBe(1);
  });

  it("integrante sem inscrição aprovada: a mensagem diz onde resolver", async () => {
    const { ana, carla, teamId } = await teamOf3();
    // caminho antigo (dado legado): linha apagada direto, sem passar pelo unregister
    await db.prepare("DELETE FROM registrations WHERE memberId = ?").run(carla.id);
    await expect(submitEntry(teamId, ana)).rejects.toThrow(/@carla está no time sem inscrição aprovada.*Meu time/);
  });

  it("PATCH /team: só tira colega sem inscrição aprovada; sair do time", async () => {
    const { ana, carla, davi } = await teamOf3();
    const { PATCH, GET } = await import("@/app/api/hackathons/[id]/team/route");
    who = "clerk_ana";
    expect(await (await GET(req("GET"), ctx())).json()).toMatchObject({ me: "ana", removable: [] });
    // carla está aprovada: só ela mesma ou a organização tiram ela do time
    const blocked = await PATCH(req("PATCH", { action: "remove", username: "@carla" }), ctx());
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/fale com a organização/);
    expect((await memberTeamFor(H, "carla"))?.members).toEqual(["ana", "carla", "davi"]);

    // dado antigo: a inscrição da carla sumiu sem passar pelo unregister
    await db.prepare("DELETE FROM registrations WHERE memberId = ?").run(carla.id);
    expect(await (await GET(req("GET"), ctx())).json()).toMatchObject({ removable: ["carla"] });
    const rm = await PATCH(req("PATCH", { action: "remove", username: "@carla" }), ctx());
    expect(rm.status).toBe(200);
    expect(await rm.json()).toMatchObject({ team: { members: ["ana", "davi"] }, removable: [] });
    expect((await notes(carla.id)).at(-1)?.type).toBe("team_member_removed");
    expect((await PATCH(req("PATCH", { action: "remove", username: "ana" }), ctx())).status).toBe(400);
    expect((await PATCH(req("PATCH", { action: "remove", username: "carla" }), ctx())).status).toBe(404);

    who = "clerk_davi";
    expect((await PATCH(req("PATCH", { action: "leave" }), ctx())).status).toBe(200);
    expect(await memberTeamFor(H, "davi")).toBeNull();
    expect((await notes(ana.id)).some((n) => n.text.includes("@davi saiu do time"))).toBe(true);
    expect(await statusOf(davi.id)).toBe("approved"); // a inscrição continua
  });

  it("B (aprovado, recém-chegado) tenta tirar A (quem criou) e recebe 403", async () => {
    const { ana, davi } = await teamOf3();
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    who = "clerk_davi";
    const res = await PATCH(req("PATCH", { action: "remove", username: "ana" }), ctx());
    expect(res.status).toBe(403);
    expect((await memberTeamFor(H, ana.username))?.members).toContain("ana");
    expect(await statusOf(davi.id)).toBe("approved");
  });

  it("último integrante cancela: o time some e o nome fica livre", async () => {
    const solo = await member("solo");
    await signup(solo);
    const { team } = await submitTeam(H, solo, { name: "Time Solo", memberUsernames: [] });
    await saveDraft(team.id, solo, full);
    await cancelRegistration(solo.id, H);
    expect(await db.prepare("SELECT 1 FROM teams WHERE id = ?").get(team.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM team_projects WHERE teamId = ?").get(team.id)).toBeUndefined();
    expect((await getArchive(H)).teams.map((t) => t.name)).not.toContain("Time Solo");
    expect(await listEntriesForAdmin(H)).toEqual(expect.not.arrayContaining([expect.objectContaining({ teamId: team.id })]));

    await signup(solo);
    const again = await submitTeam(H, solo, { name: "Time Solo", memberUsernames: [] });
    expect(again.team.name).toBe("Time Solo");
  });

  it("time que enviou versão e ficou vazio fica guardado, fora do júri e da vitrine", async () => {
    const { ana, carla, davi, teamId } = await teamOf3();
    await db.prepare("UPDATE hackathons SET submissionDeadline = '2027-01-01 00:00:00', submissionGraceMinutes = 0 WHERE id = ?").run(H);
    await submitEntry(teamId, ana);
    expect((await listJuryTeams(H)).map((t) => t.id)).toContain(teamId);
    for (const m of [ana, carla, davi]) await cancelRegistration(m.id, H);
    expect(await db.prepare("SELECT 1 AS ok FROM teams WHERE id = ?").get(teamId)).toEqual({ ok: 1 });
    expect((await listJuryTeams(H)).map((t) => t.id)).not.toContain(teamId);
    expect((await getArchive(H)).teams.map((t) => t.id)).not.toContain(teamId);
    expect(await getProjectByTeamId(teamId)).toBeNull();
    expect((await listEntriesForAdmin(H)).some((e) => e.teamId === teamId)).toBe(true);
  });

  it("time travado na entrega não muda de integrante", async () => {
    await teamOf3();
    await db
      .prepare("UPDATE hackathons SET submissionDeadline = '2026-01-01 00:00:00', submissionGraceMinutes = 0 WHERE id = ?")
      .run(H);
    who = "clerk_ana";
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    expect((await PATCH(req("PATCH", { action: "leave" }), ctx())).status).toBe(409);
  });

  it("dois envios ao mesmo tempo viram versões 1 e 2", async () => {
    const { ana, davi, teamId } = await teamOf3();
    const [a, b] = await Promise.all([submitEntry(teamId, ana), submitEntry(teamId, davi)]);
    expect([a.version, b.version].sort()).toEqual([1, 2]);
  });
});

describe("procuro time (board-expoe-contato-e-nao-desativa)", () => {
  it("GET anônimo não traz nota nem memberId; inscrito aprovado vê a nota", async () => {
    const m = await member("anuncia");
    await signup(m);
    await upsertBoardEntry(m.id, H, { skills: ["react"], need: "back", note: "chego sexta" });
    const { GET } = await import("@/app/api/hackathons/[id]/team-board/route");
    const anon = (await (await GET(req("GET"), ctx())).json()).entries;
    expect(anon).toHaveLength(1);
    expect(anon[0]).not.toHaveProperty("note");
    expect(anon[0]).not.toHaveProperty("memberId");
    who = "clerk_anuncia";
    const mine = (await (await GET(req("GET"), ctx())).json()).entries;
    expect(mine[0].note).toBe("chego sexta");
    expect(mine[0]).not.toHaveProperty("memberId");
  });

  it("aceitar convite e criar time desativam o anúncio", async () => {
    const cap = await member("capb");
    const solo = await member("solob");
    for (const m of [cap, solo]) {
      await signup(m);
      await upsertBoardEntry(m.id, H, { skills: [], need: "time", note: null });
    }
    await submitTeam(H, cap, { name: "Board Team", memberUsernames: ["solob"] });
    expect((await getBoardEntry(cap.id, H))?.active).toBe(false);
    const [inv] = await listMyInvites(solo.id, H);
    await respondInvite(inv.id, solo, "accept");
    expect((await getBoardEntry(solo.id, H))?.active).toBe(false);
  });

  it("menor não publica telefone na nota; edição encerrada não aceita anúncio", async () => {
    const m = await member("menor");
    await signup(m);
    await db.prepare("UPDATE registration_terms SET ageAtEvent = 16 WHERE memberId = ?").run(m.id);
    who = "clerk_menor";
    const { POST } = await import("@/app/api/hackathons/[id]/team-board/route");
    const phone = await POST(req("POST", { need: "front", note: "zap 11 99999-0000" }), ctx());
    expect(phone.status).toBe(400);
    expect((await POST(req("POST", { need: "front", note: "chego sexta" }), ctx())).status).toBe(201);

    await db.prepare("UPDATE hackathons SET endsAt = '2026-01-02T18:00:00-03:00' WHERE id = ?").run(H);
    try {
      expect((await POST(req("POST", { need: "front" }), ctx())).status).toBe(409);
    } finally {
      await db.prepare("UPDATE hackathons SET endsAt = '2026-11-15T18:00:00-03:00' WHERE id = ?").run(H);
    }
  });
});

describe("aviso de decisão (reprovacao-sem-aviso)", () => {
  it("aprovar e recusar viram notificação pra pessoa", async () => {
    await db.prepare("UPDATE hackathons SET requiresApproval = 1 WHERE id = ?").run(H);
    const ok = await member("aprovada");
    const no = await member("recusada");
    await signup(ok);
    await signup(no);
    await reviewRegistration(ok.id, H, "approve");
    await reviewRegistration(no.id, H, "reject");
    expect(await notes(ok.id)).toEqual([expect.objectContaining({ type: "registration_approved", href: `/h/${H}/ingresso` })]);
    expect(await notes(no.id)).toEqual([expect.objectContaining({ type: "registration_rejected" })]);
  });
});

describe("dieta depois da inscrição (dieta-sem-edicao-posterior)", () => {
  it("PATCH grava a restrição nova até o início do evento", async () => {
    await db
      .prepare(
        `INSERT INTO edition_terms (hackathonId, dietEnabled) VALUES (?, 1)
         ON CONFLICT (hackathonId) DO UPDATE SET dietEnabled = 1`,
      )
      .run(H);
    const m = await member("dieta");
    await signup(m);
    who = "clerk_dieta";
    const { PATCH } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await PATCH(req("PATCH", { diet: ["vegano"], allergies: "amendoim", allergySevere: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ diet: ["vegano"], allergies: "amendoim", allergySevere: true });
    const row = await db
      .prepare("SELECT diet, allergies, allergySevere FROM registration_terms WHERE memberId = ?")
      .get<{ diet: string; allergies: string; allergySevere: number }>(m.id);
    expect(row).toEqual({ diet: '["vegano"]', allergies: "amendoim", allergySevere: 1 });
    expect((await PATCH(req("PATCH", { diet: ["pizza"] }), ctx())).status).toBe(400);
  });
});

describe("painel de entregas sem N+1 (n1-listEntriesForAdmin)", () => {
  it("mesmo resultado que montar entrega por entrega", async () => {
    const a = await member("adm_a");
    const b = await member("adm_b");
    await signup(a);
    await signup(b);
    const t1 = (await submitTeam(H, a, { name: "Alfa" })).team.id;
    const t2 = (await submitTeam(H, b, { name: "Beta" })).team.id;
    await saveDraft(t1, a, { title: "Um", tagline: "x", description: "d", priorWork: "n", technologies: ["Go"], repoUrl: "https://g.dev/um" });
    await submitEntry(t1, a);
    await saveDraft(t1, a, { tagline: "mudou" });
    const rows = await listEntriesForAdmin(H);
    const one = await Promise.all([t1, t2].map((id) => getEntry(id)));
    expect(rows.map((r) => r.teamName)).toEqual(["Alfa", "Beta"]);
    for (const [i, e] of one.entries()) {
      expect(rows[i]).toMatchObject({
        teamId: e!.teamId,
        members: e!.members,
        title: e!.fields?.title ?? null,
        status: e!.status,
        versions: e!.versions.length,
        dirty: e!.dirty,
      });
    }
    expect(rows[0].dirty).toBe(true);
  });
});

describe("fila de espera e time por edição", () => {
  it("quem está na fila usa as dúvidas; recusado não (duvidas-bloqueia-fila)", async () => {
    const { canUseQuestions } = await import("@/lib/questions");
    await db.prepare("UPDATE hackathons SET capacity = 1 WHERE id = ?").run(H);
    const ana = await member("ana");
    const bia = await member("bia");
    await signup(ana);
    await signup(bia);
    expect(await statusOf(bia.id)).toBe("waitlist");
    expect(await canUseQuestions({ id: bia.id, role: "member" }, H)).toBe(true);
    await reviewRegistration(bia.id, H, "reject");
    expect(await canUseQuestions({ id: bia.id, role: "member" }, H)).toBe(false);
  });

  it("memberTeamFor devolve o mesmo time que o arquivo da edição (n1-getArchive-memberTeamFor)", async () => {
    const { getArchive } = await import("@/lib/archive");
    const ana = await member("ana");
    const bia = await member("bia");
    await signup(ana);
    await signup(bia);
    await submitTeam(H, bia, { name: "Outro" });
    const { team } = await submitTeam(H, ana, {
      name: "Mapa",
      project: { title: "Mapa", description: "d", repoUrl: "https://github.com/t/mapa" },
    });
    const fromArchive = (await getArchive(H)).teams.find((t) => t.id === team.id);
    expect(await memberTeamFor(H, "ana")).toEqual(fromArchive);
    expect(await memberTeamFor(H, "ninguem")).toBeNull();
  });
});

describe("RSVP libera a vaga pelo unregister sem regra de cancelamento", () => {
  // edição que já começou no relógio real; o RSVP roda com `now` anterior
  const ED = "pkgc-rsvp";
  const START = "2026-03-14T09:00:00-03:00"; // 12:00Z
  const OPENS = new Date("2026-03-07T12:00:00Z");
  const DEADLINE = new Date("2026-03-12T03:00:00Z");
  const MAILENV = { RESEND_API_KEY: "re_teste" };

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "ok" }), { status: 200 }));
    await db.prepare("UPDATE hackathons SET rsvpEnabled = 0").run();
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, rsvpEnabled, source)
         VALUES (?, 'RSVP C', 'Hack Inova', ?, NULL, 'presencial', 'Rua Teste, 100', '/x', '[]', 1, 1, 'painel')
         ON CONFLICT (id) DO UPDATE SET rsvpEnabled = 1`,
      )
      .run(ED, START);
  });

  const approved = async (username: string) => {
    const m = await member(username);
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .get<{ id: number }>(m.id, ED);
    return { ...m, regId: r!.id };
  };

  it("recusa pelo link antes do início passa mesmo com o relógio real depois do início", async () => {
    const a = await approved("rsvp_recusa");
    await processRsvp(OPENS, { env: MAILENV });
    const res = await respondRsvp(rsvpToken(a.regId, DEADLINE), "decline", new Date("2026-03-09T12:00:00Z"), {});
    expect(res).toMatchObject({ ok: true, status: "declined", already: false });
    expect(await statusOf(a.id, ED)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("prazo vencido com check-in feito não derruba o cron: as outras vagas expiram", async () => {
    const a = await approved("rsvp_presente");
    const b = await approved("rsvp_sumido");
    await processRsvp(OPENS, { env: MAILENV });
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(a.regId);
    const out = await processRsvp(DEADLINE, { env: MAILENV });
    expect(out.expired).toBeGreaterThanOrEqual(1);
    expect(await statusOf(b.id, ED)).toBeNull();
    expect(await db.prepare("SELECT outcome FROM rsvp_releases WHERE memberId = ?").get(b.id)).toEqual({ outcome: "expired" });
    vi.unstubAllGlobals();
  });
});
