import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { createChallenge } from "@/lib/challenges";
import { reopenEntry, saveDraft, submitEntry, toDbTime } from "@/lib/entries";
import { addCriterion, assignAll, assignJudge, judgeAssignments, listJuryTeams, publishResults, saveScores } from "@/lib/jury";
import { categoryCandidates, createCategory, listWinners, pickWinners } from "@/lib/prizes";
import { issueCertificates, listMemberCertificates } from "@/lib/certificates";
import { grantEditionRole } from "@/lib/roles";

// júri × entrega × categorias de prêmio — spec 034 §5 (critérios de aceite)

const H = "hack-inova-alphaville-2026";
const DEADLINE = new Date(Date.now() + 3_600_000); // prazo daqui 1h (relógio real)
const before = (m: number) => new Date(DEADLINE.getTime() - m * 60_000);
const after = (m: number) => new Date(DEADLINE.getTime() + m * 60_000);

const full = {
  tagline: "uma linha",
  description: "o que faz",
  priorWork: "nada",
  technologies: ["Python"],
  repoUrl: "https://github.com/x/y",
};

async function memberId(username: string, checkin = true): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`);
  const id = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
  await db.prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(id, H);
  if (checkin) {
    await db
      .prepare("INSERT OR IGNORE INTO checkins (registrationId) SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
      .run(id, H);
  }
  return id;
}

async function team(name: string, members: string[], opts: { submit?: boolean; challenges?: string[] } = {}) {
  for (const u of members) await memberId(u);
  const id = (await createTeam(H, { name, placement: 0, memberUsernames: members })).team.id;
  await saveDraft(id, { username: members[0] }, { title: `${name} app`, ...full, challengeIds: opts.challenges ?? [] }, before(50));
  if (opts.submit !== false) {
    const mid = await memberId(members[0]);
    await submitEntry(id, { id: mid, username: members[0] }, before(40));
  }
  return id;
}

beforeEach(async () => {
  for (const t of ["checkins", "certificates", "scores", "judge_assignments", "rubric_criteria", "jury_results", "edition_roles", "deliveries", "announcement_reads", "announcements", "submission_events", "project_submissions", "project_challenges", "prize_winners", "prize_categories"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM teams WHERE hackathonId = '${H}'`);
  await db.exec(`DELETE FROM registrations WHERE hackathonId = '${H}'`);
  await db.prepare("UPDATE hackathons SET submissionDeadline = ?, submissionGraceMinutes = 0 WHERE id = ?").run(toDbTime(DEADLINE), H);
});

describe("puro", () => {
  it("vencedores = posição ≤ places, empate entra junto", () => {
    expect(pickWinners([{ teamId: 1, rank: 1 }, { teamId: 2, rank: 2 }, { teamId: 3, rank: 2 }, { teamId: 4, rank: null }], 2)).toEqual([
      { teamId: 1, place: 1 },
      { teamId: 2, place: 2 },
      { teamId: 3, place: 2 },
    ]);
  });

  it("candidatos: desafio só com quem marcou; finalistsOnly só finalista", () => {
    const teams = [{ id: 1, finalist: true }, { id: 2, finalist: false }, { id: 3, finalist: false }];
    const marks = new Map([[2, ["c1"]], [3, ["c2"]]]);
    expect(categoryCandidates({ kind: "desafio", challengeId: "c1", finalistsOnly: false }, teams, marks).map((t) => t.id)).toEqual([2]);
    expect(categoryCandidates({ kind: "geral", challengeId: null, finalistsOnly: true }, teams, marks).map((t) => t.id)).toEqual([1]);
    expect(categoryCandidates({ kind: "geral", challengeId: null, finalistsOnly: false }, teams, marks)).toHaveLength(3);
  });
});

describe("júri só com entregue", () => {
  it("assignAll ignora rascunho; atribuição manual de rascunho dá 409", async () => {
    const j = await memberId("jur_e");
    await grantEditionRole(H, j, "jurado", null);
    await team("Entregue", ["p1"]);
    const rascunho = await team("Rascunho", ["p2"], { submit: false });
    expect(await assignAll(H)).toEqual({ created: 1, conflicts: 0 });
    expect((await listJuryTeams(H)).map((t) => t.name)).toEqual(["Entregue"]);
    await expect(assignJudge(H, j, rascunho)).rejects.toMatchObject({ status: 409 });
  });

  it("jurado vê o snapshot da versão do prazo mesmo após reabertura e reenvio", async () => {
    const j = await memberId("jur_v");
    await grantEditionRole(H, j, "jurado", null);
    const t = await team("Versao", ["p3"]);
    const p3 = await memberId("p3");
    await reopenEntry(H, t, j, { reason: "ajuste combinado", minutes: 60 }, after(5));
    await saveDraft(t, { username: "p3" }, { tagline: "mudou depois" }, after(10));
    await submitEntry(t, { id: p3, username: "p3" }, after(11));
    await assignAll(H);
    const [a] = await judgeAssignments(H, j);
    expect(a.judged?.version).toBe(1);
    expect(a.judged?.snapshot.tagline).toBe("uma linha");
  });

  it("assignAll finalistsOnly atribui só finalista", async () => {
    const j = await memberId("jur_f");
    await grantEditionRole(H, j, "jurado", null);
    const fin = await team("Fin", ["p4"]);
    await team("NaoFin", ["p5"]);
    await db.prepare("UPDATE teams SET finalist = 1 WHERE id = ?").run(fin);
    expect(await assignAll(H, { finalistsOnly: true })).toEqual({ created: 1, conflicts: 0 });
  });
});

describe("categorias de prêmio na publicação", () => {
  it("desafio só com quem marcou; certificado por categoria só pra integrante presente", async () => {
    const chal = await createChallenge(H, { sponsor: "Acme", title: "Melhor uso de IA" });
    const j = await memberId("jur_c");
    await grantEditionRole(H, j, "jurado", null);
    const c = await addCriterion(H, { label: "Geral", weight: 1 });
    const top = await team("Topo", ["q1"]); // nota maior, NÃO marcou o desafio
    const marcou = await team("Marcou", ["q2", "q3"], { challenges: [chal.id] });
    await memberId("q3", false); // q3 já existia com check-in; tira a presença dele:
    await db.exec(`DELETE FROM checkins WHERE registrationId IN (SELECT r.id FROM registrations r JOIN members m ON m.id = r.memberId WHERE m.username = 'q3')`);
    await assignAll(H);
    await saveScores(H, j, top, [{ criterionId: c.id, score: 5 }], null);
    await saveScores(H, j, marcou, [{ criterionId: c.id, score: 3 }], null);

    const geral = await createCategory(H, { kind: "geral", name: "Geral", places: 2 });
    const desafio = await createCategory(H, { kind: "desafio", challengeId: chal.id });
    expect(desafio.name).toContain("Acme");

    const res = await publishResults(H, null);
    expect(res.winners).toEqual([
      { categoryId: geral.id, teamId: top, place: 1 },
      { categoryId: geral.id, teamId: marcou, place: 2 },
      { categoryId: desafio.id, teamId: marcou, place: 1 },
    ]);
    expect((await listWinners(H)).filter((w) => w.categoryId === desafio.id).map((w) => w.teamName)).toEqual(["Marcou"]);

    await db.prepare("UPDATE hackathons SET startsAt = '2020-01-01', endsAt = '2020-01-02' WHERE id = ?").run(H);
    await issueCertificates(H);
    const q2 = await memberId("q2");
    const q3 = await memberId("q3", false);
    const prizes = (await listMemberCertificates(q2)).filter((x) => x.kind === "premiacao").map((x) => x.detail).sort();
    expect(prizes).toEqual([
      "1º lugar em Melhor projeto — Acme: Melhor uso de IA com o time Marcou",
      "2º lugar em Geral com o time Marcou",
    ]);
    expect((await listMemberCertificates(q3)).filter((x) => x.kind === "premiacao")).toEqual([]);
    // reemitir não duplica
    expect((await issueCertificates(H)).created).toBe(0);
  });
});
