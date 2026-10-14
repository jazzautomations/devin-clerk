import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam, getArchive } from "@/lib/archive";
import { grantEditionRole, revokeEditionRole } from "@/lib/roles";
import { setFeedbackReleased } from "@/lib/juryFeedback";
import {
  addCriterion,
  assignAll,
  assignJudge,
  computeRanking,
  getRanking,
  hasConflict,
  isPublished,
  judgeAssignments,
  JuryError,
  JuryPublishIncomplete,
  juryProgress,
  listAssignments,
  publishResults,
  publishedRanking,
  rankingFor,
  removeCriterion,
  saveScores,
  unassignJudge,
  updateCriterion,
} from "@/lib/jury";

// júri com rubrica — spec 033 US5 / FR-006

const H = "hack-inova-alphaville-2026";

async function memberId(username: string, role = "member"): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`, role);
  return (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
}

async function judge(username: string) {
  const id = await memberId(username);
  await grantEditionRole(H, id, "jurado", null);
  return id;
}

async function team(name: string, members: string[] = []) {
  for (const u of members) await memberId(u);
  return (await createTeam(H, { name, placement: 0, memberUsernames: members, project: { title: `${name} app` } })).team.id;
}

beforeEach(async () => {
  await db.exec("DELETE FROM scores");
  await db.exec("DELETE FROM judge_assignments");
  await db.exec("DELETE FROM rubric_criteria");
  await db.exec("DELETE FROM jury_results");
  await db.exec("DELETE FROM edition_roles");
  await db.exec(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM teams WHERE hackathonId = '${H}'`);
});

describe("computeRanking — média ponderada pura", () => {
  const teams = [
    { id: 1, name: "A", title: null },
    { id: 2, name: "B", title: null },
    { id: 3, name: "C", title: null },
  ];

  it("pondera pela média de cada critério entre jurados", () => {
    const criteria = [
      { id: 10, weight: 30 },
      { id: 11, weight: 10 },
    ];
    const scores = [
      // A: crit10 = (5+3)/2 = 4, crit11 = 1 → (4*30 + 1*10)/40 = 3.25
      { judgeMemberId: 1, teamId: 1, criterionId: 10, score: 5 },
      { judgeMemberId: 2, teamId: 1, criterionId: 10, score: 3 },
      { judgeMemberId: 1, teamId: 1, criterionId: 11, score: 1 },
      // B: crit10 = 3, crit11 = 5 → (90 + 50)/40 = 3.5
      { judgeMemberId: 1, teamId: 2, criterionId: 10, score: 3 },
      { judgeMemberId: 1, teamId: 2, criterionId: 11, score: 5 },
    ];
    const r = computeRanking(teams, criteria, scores);
    expect(r.map((x) => [x.teamId, x.weighted, x.rank])).toEqual([
      [2, 3.5, 1],
      [1, 3.25, 2],
      [3, null, null], // sem nota fica no fim, sem posição
    ]);
    expect(r[1].judges).toBe(2);
  });

  it("empate fica visível: mesma posição, marcado, e o próximo pula", () => {
    const criteria = [{ id: 10, weight: 1 }];
    const scores = [
      { judgeMemberId: 1, teamId: 1, criterionId: 10, score: 4 },
      { judgeMemberId: 1, teamId: 2, criterionId: 10, score: 4 },
      { judgeMemberId: 1, teamId: 3, criterionId: 10, score: 2 },
    ];
    const r = computeRanking(teams, criteria, scores);
    expect(r.map((x) => [x.rank, x.tied])).toEqual([
      [1, true],
      [1, true],
      [3, false],
    ]);
  });

  it("trocar o peso muda a ordem com as mesmas notas", () => {
    const scores = [
      { judgeMemberId: 1, teamId: 1, criterionId: 10, score: 5 },
      { judgeMemberId: 1, teamId: 1, criterionId: 11, score: 1 },
      { judgeMemberId: 1, teamId: 2, criterionId: 10, score: 1 },
      { judgeMemberId: 1, teamId: 2, criterionId: 11, score: 5 },
    ];
    const a = computeRanking(teams.slice(0, 2), [{ id: 10, weight: 3 }, { id: 11, weight: 1 }], scores);
    const b = computeRanking(teams.slice(0, 2), [{ id: 10, weight: 1 }, { id: 11, weight: 3 }], scores);
    expect(a[0].teamId).toBe(1);
    expect(b[0].teamId).toBe(2);
  });
});

describe("rubrica, atribuição e notas no banco", () => {
  it("critério valida label e peso; alterar peso recalcula sem perder nota", async () => {
    await expect(addCriterion(H, { label: " ", weight: 10 })).rejects.toThrow(JuryError);
    await expect(addCriterion(H, { label: "x", weight: 0 })).rejects.toThrow(/peso/);
    const impacto = await addCriterion(H, { label: "Impacto", weight: 30 });
    const pitch = await addCriterion(H, { label: "Pitch", weight: 10 });
    const j = await judge("jur_a");
    const t1 = await team("Alfa");
    const t2 = await team("Beta");
    await assignJudge(H, j, t1);
    await assignJudge(H, j, t2);
    await saveScores(H, j, t1, [{ criterionId: impacto.id, score: 5 }, { criterionId: pitch.id, score: 1 }], "bom");
    await saveScores(H, j, t2, [{ criterionId: impacto.id, score: 1 }, { criterionId: pitch.id, score: 5 }], null);
    expect((await getRanking(H))[0].teamId).toBe(t1);

    await updateCriterion(H, pitch.id, { weight: 90 });
    expect((await getRanking(H))[0].teamId).toBe(t2);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM scores").get<{ n: number }>();
    expect(n!.n).toBe(4);

    await removeCriterion(H, pitch.id);
    expect((await getRanking(H))[0].teamId).toBe(t1);
  });

  it("nota fora de 1..5, critério de outra edição ou sem atribuição é recusada", async () => {
    const c = await addCriterion(H, { label: "Execução", weight: 1 });
    const other = await addCriterion("hack-inova-unifacens-2026", { label: "Outro", weight: 1 });
    const j = await judge("jur_b");
    const t = await team("Gama");
    await expect(saveScores(H, j, t, [{ criterionId: c.id, score: 4 }], null)).rejects.toMatchObject({ status: 403 });
    await assignJudge(H, j, t);
    await expect(saveScores(H, j, t, [{ criterionId: c.id, score: 6 }], null)).rejects.toMatchObject({ status: 400 });
    await expect(saveScores(H, j, t, [{ criterionId: c.id, score: 2.5 }], null)).rejects.toMatchObject({ status: 400 });
    await expect(saveScores(H, j, t, [{ criterionId: other.id, score: 3 }], null)).rejects.toMatchObject({ status: 400 });
    await saveScores(H, j, t, [{ criterionId: c.id, score: 2 }], null);
    await saveScores(H, j, t, [{ criterionId: c.id, score: 4 }], "revisei");
    const [a] = await judgeAssignments(H, j);
    expect(a.scores).toEqual({ [c.id]: 4 });
    expect(a.comment).toBe("revisei");
  });

  it("só quem tem papel jurado (de verdade) pode ser atribuído", async () => {
    const naoJurado = await memberId("nao_jurado");
    const t = await team("Delta");
    await expect(assignJudge(H, naoJurado, t)).rejects.toMatchObject({ status: 400 });
  });
});

describe("conflito de interesse", () => {
  it("jurado do próprio time: bloqueado na atribuição, no atribuir-todos e na nota", async () => {
    const c = await addCriterion(H, { label: "Impacto", weight: 1 });
    const j = await judge("jur_dono");
    const proprio = await team("Proprio", ["jur_dono", "colega_x"]);
    const alheio = await team("Alheio", ["outro_y"]);
    expect(await hasConflict(proprio, j)).toBe(true);
    expect(await hasConflict(alheio, j)).toBe(false);
    await expect(assignJudge(H, j, proprio)).rejects.toMatchObject({ status: 409 });

    const res = await assignAll(H);
    expect(res).toEqual({ created: 1, conflicts: 1 });
    expect(await listAssignments(H)).toEqual([{ judgeMemberId: j, teamId: alheio }]);

    // mesmo que a atribuição exista por fora (entrou no time depois), a nota é barrada
    await db
      .prepare("INSERT INTO judge_assignments (hackathonId, judgeMemberId, teamId) VALUES (?, ?, ?)")
      .run(H, j, proprio);
    await expect(saveScores(H, j, proprio, [{ criterionId: c.id, score: 5 }], null)).rejects.toMatchObject({ status: 403 });
  });

  it("atribuir todos é idempotente", async () => {
    await judge("jur_1");
    await judge("jur_2");
    await team("T1");
    await team("T2");
    expect(await assignAll(H)).toEqual({ created: 4, conflicts: 0 });
    expect(await assignAll(H)).toEqual({ created: 0, conflicts: 0 });
  });
});

describe("progresso, sigilo e publicação", () => {
  it("progresso conta avaliações completas (todos os critérios) por jurado", async () => {
    const c1 = await addCriterion(H, { label: "A", weight: 1 });
    const c2 = await addCriterion(H, { label: "B", weight: 1 });
    const j = await judge("jur_prog");
    const t1 = await team("P1");
    await team("P2");
    await assignAll(H);
    await saveScores(H, j, t1, [{ criterionId: c1.id, score: 3 }], null);
    let p = await juryProgress(H);
    expect(p).toMatchObject({ expected: 2, done: 0, missing: 2 });
    await saveScores(H, j, t1, [{ criterionId: c2.id, score: 3 }], null);
    p = await juryProgress(H);
    expect(p).toMatchObject({ expected: 2, done: 1, missing: 1 });
    expect(p.byJudge).toEqual([expect.objectContaining({ username: "jur_prog", assigned: 2, complete: 1 })]);
  });

  it("jurado não vê ranking antes da publicação; organizador vê; depois todos os do júri veem", async () => {
    const c = await addCriterion(H, { label: "A", weight: 1 });
    const j = await judge("jur_sig");
    const j2 = await judge("jur_sig2");
    const org = await memberId("org_sig");
    await grantEditionRole(H, org, "organizador", null);
    const t = await team("S1");
    await assignAll(H);
    await saveScores(H, j2, t, [{ criterionId: c.id, score: 5 }], "nota do outro");

    const jActor = { id: j, role: "member" };
    expect(await rankingFor(jActor, H)).toBeNull();
    expect(await rankingFor({ id: org, role: "member" }, H)).not.toBeNull();
    // jurado só enxerga as próprias notas — a do colega não vaza
    const [mine] = await judgeAssignments(H, j);
    expect(mine.scores).toEqual({});
    expect(mine.comment).toBeNull();
    await saveScores(H, j, t, [{ criterionId: c.id, score: 4 }], null);

    await publishResults(H, org);
    expect(await isPublished(H)).toMatchObject({ publishedBy: org });
    expect(await rankingFor(jActor, H)).not.toBeNull();
    // nota trava depois de publicado
    await expect(saveScores(H, j, t, [{ criterionId: c.id, score: 1 }], null)).rejects.toMatchObject({ status: 409 });
  });

  it("publicar grava placement 1/2/3 dos primeiros, zera o resto e respeita empate", async () => {
    const c = await addCriterion(H, { label: "A", weight: 1 });
    const j = await judge("jur_pub");
    const ids = [];
    for (const [name, score] of [["Ouro", 5], ["Prata", 4], ["Prata2", 4], ["Quarto", 2], ["Quinto", 1]] as const) {
      const t = await team(name);
      await assignJudge(H, j, t);
      await saveScores(H, j, t, [{ criterionId: c.id, score }], null);
      ids.push(t);
    }
    const semNota = await team("SemNota");
    await db.prepare("UPDATE teams SET placement = 1 WHERE id = ?").run(semNota);

    const res = await publishResults(H, null);
    expect(res.podium).toEqual([
      { teamId: ids[0], placement: 1 },
      { teamId: ids[1], placement: 2 },
      { teamId: ids[2], placement: 2 },
    ]);
    const placement = Object.fromEntries((await getArchive(H)).teams.map((t) => [t.name, t.placement]));
    expect(placement).toEqual({ Ouro: 1, Prata: 2, Prata2: 2, Quarto: 0, Quinto: 0, SemNota: 0 });

    // republicar é idempotente: um registro só
    await publishResults(H, null);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM jury_results WHERE hackathonId = ?").get<{ n: number }>(H);
    expect(n!.n).toBe(1);
  });
});

describe("auditoria 041 — resultado justo e congelado", () => {
  it("time A com 1 nota (num critério de 3) não fica à frente de B avaliado por completo", () => {
    const teams = [
      { id: 1, name: "A", title: null },
      { id: 2, name: "B", title: null },
    ];
    const criteria = [10, 11, 12].map((id) => ({ id, weight: 1 }));
    const scores = [
      { judgeMemberId: 1, teamId: 1, criterionId: 10, score: 5 },
      ...[1, 2, 3].flatMap((j) => criteria.map((c) => ({ judgeMemberId: j, teamId: 2, criterionId: c.id, score: 4 }))),
    ];
    const r = computeRanking(teams, criteria, scores);
    expect(r.map((x) => [x.name, x.rank, x.incomplete, x.missingScores])).toEqual([
      ["B", 1, false, 0],
      ["A", 2, true, 2],
    ]);
    // com a lista de atribuição: A tinha 3 jurados, faltam 8 notas
    const assignments = [1, 2, 3].flatMap((j) => [1, 2].map((teamId) => ({ judgeMemberId: j, teamId })));
    const r2 = computeRanking(teams, criteria, scores, assignments);
    expect(r2.find((x) => x.name === "A")).toMatchObject({ rank: 2, incomplete: true, missingScores: 8 });
  });

  it("publicar com avaliação faltando dá 409 com a contagem; force pede motivo e grava", async () => {
    const c = await addCriterion(H, { label: "A", weight: 1 });
    const j1 = await judge("jur_inc1");
    const j2 = await judge("jur_inc2");
    const t = await team("Inc1");
    await assignAll(H);
    await saveScores(H, j1, t, [{ criterionId: c.id, score: 5 }], null);
    const err = await publishResults(H, null).catch((e) => e);
    expect(err).toBeInstanceOf(JuryPublishIncomplete);
    expect(err).toMatchObject({ status: 409, missing: 1, missingScores: 1 });
    expect(await isPublished(H)).toBeNull();
    await expect(publishResults(H, null, { force: true, reason: "curto" })).rejects.toMatchObject({ status: 400 });
    const res = await publishResults(H, null, { force: true, reason: "  jurado 2 não apareceu  " });
    expect(res).toMatchObject({ forced: true, first: true });
    expect(await isPublished(H)).toMatchObject({ forced: true, reason: "jurado 2 não apareceu" });
    expect(j2).toBeGreaterThan(0);
  });

  it("depois de publicar a rubrica trava (409) e o ranking lido é o congelado", async () => {
    const c = await addCriterion(H, { label: "A", weight: 1 });
    const j = await judge("jur_snap");
    const org = await memberId("org_snap");
    await grantEditionRole(H, org, "organizador", null);
    const t1 = await team("Snap1");
    const t2 = await team("Snap2");
    await assignAll(H);
    await saveScores(H, j, t1, [{ criterionId: c.id, score: 5 }], null);
    await saveScores(H, j, t2, [{ criterionId: c.id, score: 3 }], null);
    await publishResults(H, org);

    await expect(removeCriterion(H, c.id)).rejects.toMatchObject({ status: 409 });
    await expect(updateCriterion(H, c.id, { weight: 9 })).rejects.toMatchObject({ status: 409 });
    await expect(addCriterion(H, { label: "Novo", weight: 1 })).rejects.toMatchObject({ status: 409 });

    // o time 1 sai do júri depois da publicação: o ao vivo muda, o publicado não
    await unassignJudge(H, j, t1);
    expect((await getRanking(H))[0]).toMatchObject({ teamId: t2, rank: 1 });
    const frozen = await rankingFor({ id: org, role: "member" }, H);
    expect(frozen![0]).toMatchObject({ teamId: t1, rank: 1, weighted: 5 });
    expect(await publishedRanking(H)).toEqual(frozen);
    expect(await rankingFor({ id: j, role: "member" }, H)).toEqual(frozen);
  });

  it("jurado que perdeu o papel não grava nota (403) e as notas dele saem do ranking e do progresso", async () => {
    const c = await addCriterion(H, { label: "A", weight: 1 });
    const j1 = await judge("jur_rev1");
    const j2 = await judge("jur_rev2");
    const t = await team("Rev1");
    await assignAll(H);
    await saveScores(H, j1, t, [{ criterionId: c.id, score: 4 }], null);
    await saveScores(H, j2, t, [{ criterionId: c.id, score: 1 }], null);
    expect((await getRanking(H))[0]).toMatchObject({ weighted: 2.5, judges: 2 });

    await revokeEditionRole(H, j2, "jurado");
    await expect(saveScores(H, j2, t, [{ criterionId: c.id, score: 2 }], null)).rejects.toMatchObject({ status: 403 });
    expect((await getRanking(H))[0]).toMatchObject({ weighted: 4, judges: 1 });
    expect(await juryProgress(H)).toMatchObject({ expected: 1, done: 1, missing: 0 });
  });

  it("liberar o feedback com resultado publicado avisa cada integrante do time com feedback", async () => {
    await db.exec("DELETE FROM notifications");
    const c = await addCriterion(H, { label: "A", weight: 1 });
    const j = await judge("jur_fb");
    const t = await team("Fb1", ["fb_ana", "fb_bia"]);
    await team("FbSemNota", ["fb_caio"]);
    await assignJudge(H, j, t);
    await saveScores(H, j, t, [{ criterionId: c.id, score: 4, feedback: "bom" }], null);
    // antes de publicar: liberar só arma, ninguém é avisado
    expect(await setFeedbackReleased(H, true)).toEqual({ notified: 0 });
    await setFeedbackReleased(H, false);
    await publishResults(H, null);
    expect(await setFeedbackReleased(H, true)).toEqual({ notified: 2 });
    const rows = await db
      .prepare("SELECT n.href, m.username FROM notifications n JOIN members m ON m.id = n.memberId WHERE n.type = 'jury_feedback' ORDER BY m.username")
      .all<{ href: string; username: string }>();
    expect(rows).toEqual([
      { href: `/p/${t}/feedback`, username: "fb_ana" },
      { href: `/p/${t}/feedback`, username: "fb_bia" },
    ]);
    // ligar de novo (já visível) não repete o aviso
    expect(await setFeedbackReleased(H, true)).toEqual({ notified: 0 });
    await setFeedbackReleased(H, false);
  });
});

describe("rubrica sem critério repetido (achado do QA)", () => {
  it("mesmo nome (ignorando maiúscula) dá 409", async () => {
    const h = "hack-inova-unifacens-2026";
    await db.prepare("DELETE FROM rubric_criteria WHERE hackathonId = ?").run(h);
    await addCriterion(h, { label: "Impacto", weight: 1 });
    await expect(addCriterion(h, { label: "impacto", weight: 2 })).rejects.toMatchObject({ status: 409 });
  });
});
