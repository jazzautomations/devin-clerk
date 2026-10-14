import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { grantEditionRole } from "@/lib/roles";
import { addCriterion, assignAll, judgeAssignments, publishResults, saveScores } from "@/lib/jury";
import {
  buildTeamFeedback,
  feedbackVisible,
  setFeedbackReleased,
  teamFeedbackFor,
} from "@/lib/juryFeedback";

// feedback do júri pro time — roadmap 037 #9 (research 036 #5)

const H = "hack-inova-alphaville-2026";

async function member(username: string) {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`);
  const id = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
  return { id, username };
}

beforeEach(async () => {
  for (const t of ["jury_team_feedback", "scores", "judge_assignments", "rubric_criteria", "jury_results", "edition_roles"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM teams WHERE hackathonId = '${H}'`);
  await db.exec(`UPDATE hackathons SET juryFeedbackReleased = 0 WHERE id = '${H}'`);
});

/** 2 jurados, 2 critérios, 2 times; o time A recebe comentários */
async function scenario() {
  const org = await member("fb_org");
  const j1 = await member("fb_jurada_ana");
  const j2 = await member("fb_jurado_beto");
  const dono = await member("fb_dono");
  const outro = await member("fb_outro");
  await grantEditionRole(H, org.id, "organizador", null);
  await grantEditionRole(H, j1.id, "jurado", null);
  await grantEditionRole(H, j2.id, "jurado", null);
  const a = (await createTeam(H, { name: "Time A", placement: 0, memberUsernames: ["fb_dono"] })).team.id;
  const b = (await createTeam(H, { name: "Time B", placement: 0, memberUsernames: ["fb_outro"] })).team.id;
  const imp = await addCriterion(H, { label: "Impacto", weight: 2 });
  const exe = await addCriterion(H, { label: "Execução", weight: 1 });
  await assignAll(H);
  await saveScores(
    H,
    j1.id,
    a,
    [
      { criterionId: imp.id, score: 5, feedback: "zebra: problema real e bem escolhido" },
      { criterionId: exe.id, score: 3, feedback: "demo travou no login" },
    ],
    "SEGREDO interno: parece TCC reciclado",
    "Ótimo pitch, faltou teste.",
  );
  await saveScores(
    H,
    j2.id,
    a,
    [
      { criterionId: imp.id, score: 3, feedback: "alcance pequeno" },
      { criterionId: exe.id, score: 4 },
    ],
    null,
    null,
  );
  await saveScores(H, j1.id, b, [{ criterionId: imp.id, score: 1 }, { criterionId: exe.id, score: 1 }], null);
  await saveScores(H, j2.id, b, [{ criterionId: imp.id, score: 3 }, { criterionId: exe.id, score: 3 }], null);
  return { org, j1, j2, dono, outro, a, b, imp, exe };
}

describe("montagem pura", () => {
  it("média do time × média da edição por critério, ponderada, comentários ordenados sem autor", () => {
    const teams = [
      { id: 1, name: "A", title: null },
      { id: 2, name: "B", title: null },
    ];
    const criteria = [
      { id: 10, label: "Impacto", weight: 2 },
      { id: 11, label: "Execução", weight: 1 },
    ];
    const scores = [
      { judgeMemberId: 7, teamId: 1, criterionId: 10, score: 5 },
      { judgeMemberId: 8, teamId: 1, criterionId: 10, score: 3 },
      { judgeMemberId: 7, teamId: 1, criterionId: 11, score: 3 },
      { judgeMemberId: 7, teamId: 2, criterionId: 10, score: 2 },
      { judgeMemberId: 7, teamId: 2, criterionId: 11, score: 2 },
    ];
    const out = buildTeamFeedback(1, teams, criteria, scores, [
      { criterionId: 10, text: "b segundo" },
      { criterionId: 10, text: "a primeiro" },
    ], ["z", "m"]);
    expect(out.judges).toBe(2);
    expect(out.criteria[0]).toMatchObject({ team: 4, edition: 3, comments: ["a primeiro", "b segundo"] });
    expect(out.criteria[1]).toMatchObject({ team: 3, edition: 2.5, comments: [] });
    // A: (4*2 + 3)/3 = 3.67; B: 2 → edição 2.83
    expect(out.weighted).toEqual({ team: 3.67, edition: 2.83 });
    expect(out.general).toEqual(["m", "z"]);
  });
});

describe("feedback pro time", () => {
  it("jurado vê de volta o que escreveu; feedback não mandado fica como estava; vazio apaga", async () => {
    const s = await scenario();
    let [mine] = (await judgeAssignments(H, s.j1.id)).filter((x) => x.id === s.a);
    expect(mine.feedback[s.imp.id]).toMatch(/zebra/);
    expect(mine.generalFeedback).toBe("Ótimo pitch, faltou teste.");
    // regrava só a nota: feedback fica (undefined = mantém)
    await saveScores(H, s.j1.id, s.a, [{ criterionId: s.imp.id, score: 4 }], null);
    [mine] = (await judgeAssignments(H, s.j1.id)).filter((x) => x.id === s.a);
    expect(mine.scores[s.imp.id]).toBe(4);
    expect(mine.feedback[s.imp.id]).toMatch(/zebra/);
    expect(mine.generalFeedback).toBe("Ótimo pitch, faltou teste.");
    // string vazia apaga
    await saveScores(H, s.j1.id, s.a, [{ criterionId: s.imp.id, score: 4, feedback: "  " }], null, "");
    [mine] = (await judgeAssignments(H, s.j1.id)).filter((x) => x.id === s.a);
    expect(mine.feedback[s.imp.id]).toBeUndefined();
    expect(mine.generalFeedback).toBeNull();
  });

  it("deslogado: unauthorized; quem não é do time (nem jurado, nem organizador): forbidden", async () => {
    const s = await scenario();
    await publishResults(H, s.org.id);
    await setFeedbackReleased(H, true);
    expect(await teamFeedbackFor(null, s.a)).toEqual({ status: "unauthorized" });
    for (const who of [s.outro, s.j1, s.org]) {
      expect(await teamFeedbackFor(who, s.a)).toEqual({ status: "forbidden" });
    }
    expect(await teamFeedbackFor(s.dono, 99999999)).toEqual({ status: "not_found" });
  });

  it("nada vaza antes da publicação, mesmo liberado; nem publicado sem liberação", async () => {
    const s = await scenario();
    await setFeedbackReleased(H, true);
    const before = await teamFeedbackFor(s.dono, s.a);
    expect(before.status).toBe("hidden");
    expect(JSON.stringify(before)).not.toMatch(/zebra|pitch|Impacto/);
    expect(await feedbackVisible(H)).toBe(false);

    await setFeedbackReleased(H, false);
    await publishResults(H, s.org.id);
    expect((await teamFeedbackFor(s.dono, s.a)).status).toBe("hidden");

    await setFeedbackReleased(H, true);
    expect((await teamFeedbackFor(s.dono, s.a)).status).toBe("ok");
    // recolher esconde de novo
    await setFeedbackReleased(H, false);
    expect((await teamFeedbackFor(s.dono, s.a)).status).toBe("hidden");
  });

  it("membro vê notas vs média e comentários anônimos — sem jurado e sem nota interna", async () => {
    const s = await scenario();
    await publishResults(H, s.org.id);
    await setFeedbackReleased(H, true);
    const res = await teamFeedbackFor(s.dono, s.a);
    if (res.status !== "ok") throw new Error(res.status);
    const f = res.feedback;
    expect(f.teamName).toBe("Time A");
    expect(f.judges).toBe(2);
    const imp = f.criteria.find((c) => c.label === "Impacto")!;
    const exe = f.criteria.find((c) => c.label === "Execução")!;
    expect(imp).toMatchObject({ team: 4, edition: 3 }); // A 4, B 2
    expect(exe).toMatchObject({ team: 3.5, edition: 2.75 }); // A 3.5, B 2
    expect(imp.comments).toEqual(["alcance pequeno", "zebra: problema real e bem escolhido"]);
    expect(exe.comments).toEqual(["demo travou no login"]);
    expect(f.general).toEqual(["Ótimo pitch, faltou teste."]);

    const blob = JSON.stringify(res);
    expect(blob).not.toContain("SEGREDO");
    for (const j of [s.j1, s.j2]) {
      expect(blob).not.toContain(j.username);
      expect(blob).not.toMatch(new RegExp(`"judgeMemberId"|"memberId"`));
    }
  });

  it("o outro time só vê o que é dele", async () => {
    const s = await scenario();
    await publishResults(H, s.org.id);
    await setFeedbackReleased(H, true);
    const res = await teamFeedbackFor(s.outro, s.b);
    if (res.status !== "ok") throw new Error(res.status);
    expect(JSON.stringify(res)).not.toMatch(/zebra|pitch|alcance|login/);
    expect(res.feedback.criteria.find((c) => c.label === "Impacto")).toMatchObject({ team: 2, edition: 3 });
  });
});
