import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { getOrCreateMember } from "@/lib/members";
import {
  advanceStage,
  castLiveVote,
  elapsedMs,
  endStage,
  getAudienceResult,
  getMyLiveVote,
  getQueue,
  getSession,
  getStageSnapshot,
  goToTeam,
  liveRanking,
  pauseTimer,
  reopenStage,
  resetTimer,
  runStageAction,
  setPitchSeconds,
  setQueue,
  setVoting,
  snapshotKey,
  stamp,
  startTimer,
  tallyFor,
} from "@/lib/stage";

// Modo palco (spec 033, frente F): fila, avanço, cronômetro, votação ao
// vivo restrita a quem fez check-in, ranking "escolha do público".

const H = "hack-inova-alphaville-2026";
const OTHER = "hack-inova-unifacens-2026";

async function member(clerkId: string) {
  return getOrCreateMember({ id: clerkId, firstName: null, lastName: null, email: `${clerkId}@t.dev` });
}

async function checkedIn(clerkId: string, hackathonId = H) {
  const m = await member(clerkId);
  await db
    .prepare(
      `INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')
       ON CONFLICT ("memberId", "hackathonId") DO UPDATE SET status = 'approved'`,
    )
    .run(m.id, hackathonId);
  const r = await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(m.id, hackathonId);
  await db.prepare("INSERT OR IGNORE INTO checkins (registrationId) VALUES (?)").run(r!.id);
  return m;
}

async function team(name: string, members: string[] = [], hackathonId = H, project = true) {
  return (
    await createTeam(hackathonId, {
      name,
      placement: 0,
      memberUsernames: members,
      project: project ? { title: `Projeto ${name}` } : undefined,
    })
  ).team.id;
}

let a: number, b: number, c: number;

beforeEach(async () => {
  for (const t of ["live_votes", "stage_queue", "stage_sessions", "checkins", "registrations"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
  a = await team("Alfa");
  b = await team("Beta");
  c = await team("Gama");
});

async function liveOn(teamId: number) {
  await setQueue(H, [a, b, c]);
  await goToTeam(H, teamId);
  await setVoting(H, true);
}

describe("fila", () => {
  it("grava a ordem e substitui por inteiro", async () => {
    await setQueue(H, [c, a, b]);
    expect((await getQueue(H)).map((t) => t.teamId)).toEqual([c, a, b]);
    await setQueue(H, [b, c]);
    expect((await getQueue(H)).map((t) => t.teamName)).toEqual(["Beta", "Gama"]);
  });

  it("recusa time sem projeto, de outra edição, repetido ou lixo (400)", async () => {
    const semProjeto = await team("Sem", [], H, false);
    const outra = await team("Fora", [], OTHER);
    for (const bad of [[semProjeto], [outra], [a, a], ["x"], "a,b", [0]]) {
      await expect(setQueue(H, bad)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("não tira da fila o time que está no palco (409) e trava depois de encerrada", async () => {
    await setQueue(H, [a, b]);
    await advanceStage(H, 1);
    await expect(setQueue(H, [b])).rejects.toMatchObject({ status: 409 });
    await endStage(H);
    await expect(setQueue(H, [a, b])).rejects.toMatchObject({ status: 409 });
  });
});

describe("avanço", () => {
  it("idle → primeiro → … → último; passa do fim/começo é 409", async () => {
    await expect(advanceStage(H, 1)).rejects.toMatchObject({ status: 409 }); // fila vazia
    await setQueue(H, [a, b, c]);
    expect((await getSession(H)).status).toBe("idle");
    expect((await advanceStage(H, 1)).currentTeamId).toBe(a);
    expect((await getSession(H)).status).toBe("live");
    await expect(advanceStage(H, -1)).rejects.toMatchObject({ status: 409 });
    expect((await advanceStage(H, 1)).currentTeamId).toBe(b);
    expect((await advanceStage(H, 1)).currentTeamId).toBe(c);
    await expect(advanceStage(H, 1)).rejects.toMatchObject({ status: 409 });
    expect((await advanceStage(H, -1)).currentTeamId).toBe(b);
  });

  it("duplo toque em 'próximo' com from=time visto não pula dois pitches", async () => {
    await setQueue(H, [a, b, c]);
    await advanceStage(H, 1, null);
    await advanceStage(H, 1, a);
    await expect(advanceStage(H, 1, a)).rejects.toMatchObject({ status: 409 });
    expect((await getSession(H)).currentTeamId).toBe(b);
  });

  it("trocar de pitch fecha a votação e zera o cronômetro", async () => {
    await liveOn(a);
    await startTimer(H);
    await advanceStage(H, 1);
    const s = await getSession(H);
    expect(s).toMatchObject({ currentTeamId: b, votingOpen: false, pitchStartedAt: null, pitchElapsedMs: 0 });
  });

  it("goto só pra time da fila", async () => {
    await setQueue(H, [a, b]);
    await expect(goToTeam(H, c)).rejects.toMatchObject({ status: 400 });
    expect((await goToTeam(H, b)).currentTeamId).toBe(b);
  });
});

describe("cronômetro", () => {
  it("inicia, pausa acumulando, retoma e reseta; start repetido é idempotente", async () => {
    await expect(startTimer(H)).rejects.toMatchObject({ status: 409 }); // ninguém no palco
    await setQueue(H, [a]);
    await advanceStage(H, 1);
    const t0 = new Date("2026-10-17T20:00:00.000Z");
    await startTimer(H, t0);
    const again = await startTimer(H, new Date(t0.getTime() + 5000));
    expect(again.pitchStartedAt).toBe(stamp(t0));
    const paused = await pauseTimer(H, new Date(t0.getTime() + 42_500));
    expect(paused.pitchElapsedMs).toBe(42_500);
    expect(paused.pitchStartedAt).toBeNull();
    const t1 = new Date(t0.getTime() + 100_000);
    const resumed = await startTimer(H, t1);
    expect(elapsedMs(resumed, new Date(t1.getTime() + 7_500))).toBe(50_000);
    expect((await resetTimer(H)).pitchElapsedMs).toBe(0);
  });

  it("snapshot traz o tempo restante (negativo = estourou)", async () => {
    await setQueue(H, [a]);
    await advanceStage(H, 1);
    await setPitchSeconds(H, 60);
    const t0 = new Date("2026-10-17T20:00:00.000Z");
    await startTimer(H, t0);
    const snap = await getStageSnapshot(H, new Date(t0.getTime() + 70_000));
    expect(snap.timer).toMatchObject({ running: true, pitchSeconds: 60, remainingMs: -10_000 });
  });

  it("tempo de pitch só entre 30s e 30min", async () => {
    for (const bad of [29, 1801, 90.5, "120"]) {
      await expect(setPitchSeconds(H, bad)).rejects.toMatchObject({ status: 400 });
    }
    expect((await setPitchSeconds(H, 240)).pitchSeconds).toBe(240);
  });
});

describe("votação", () => {
  it("abrir exige pitch no palco; abrir/fechar é idempotente", async () => {
    await expect(setVoting(H, true)).rejects.toMatchObject({ status: 409 });
    await setQueue(H, [a]);
    await advanceStage(H, 1);
    expect((await setVoting(H, true)).votingOpen).toBe(true);
    expect((await setVoting(H, true)).votingOpen).toBe(true);
    expect((await setVoting(H, false)).votingOpen).toBe(false);
  });

  it("só quem fez check-in vota (403); inscrito sem check-in também não", async () => {
    await liveOn(a);
    const anon = await member("c_sem_inscricao");
    await expect(castLiveVote(H, anon.id, a, 5)).rejects.toMatchObject({ status: 403 });
    const inscrito = await member("c_inscrito");
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
      .run(inscrito.id, H);
    await expect(castLiveVote(H, inscrito.id, a, 5)).rejects.toMatchObject({ status: 403 });
    // check-in em OUTRA edição não vale aqui
    const outro = await checkedIn("c_outra", OTHER);
    await expect(castLiveVote(H, outro.id, a, 5)).rejects.toMatchObject({ status: 403 });
    const ok = await checkedIn("c_ok");
    expect(await castLiveVote(H, ok.id, a, 5)).toEqual({ score: 5 });
  });

  it("integrante não vota no próprio time (403), mas vota nos outros", async () => {
    const dono = await checkedIn("c_dono");
    const d = await team("Delta", [dono.username]);
    await setQueue(H, [d, a]);
    await advanceStage(H, 1);
    await setVoting(H, true);
    await expect(castLiveVote(H, dono.id, d, 5)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("próprio time"),
    });
    await advanceStage(H, 1);
    await setVoting(H, true);
    expect(await castLiveVote(H, dono.id, a, 4)).toEqual({ score: 4 });
  });

  it("voto editável enquanto aberta; fechada ou pitch que saiu → 409", async () => {
    const v = await checkedIn("c_v");
    await liveOn(a);
    await castLiveVote(H, v.id, a, 2);
    await castLiveVote(H, v.id, a, 5);
    expect(await getMyLiveVote(H, v.id, a)).toBe(5);
    expect((await tallyFor(H, a)).count).toBe(1);
    await setVoting(H, false);
    await expect(castLiveVote(H, v.id, a, 1)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("fechada"),
    });
    expect(await getMyLiveVote(H, v.id, a)).toBe(5);
    await advanceStage(H, 1);
    await setVoting(H, true);
    await expect(castLiveVote(H, v.id, a, 1)).rejects.toMatchObject({ status: 409 });
  });

  it("nota fora de 1–5 é 400; final encerrada é 409", async () => {
    const v = await checkedIn("c_n");
    await liveOn(a);
    for (const bad of [0, 6, 3.5, "5", null]) {
      await expect(castLiveVote(H, v.id, a, bad)).rejects.toMatchObject({ status: 400 });
    }
    await endStage(H);
    await expect(castLiveVote(H, v.id, a, 3)).rejects.toMatchObject({ status: 409 });
  });

  it("mesmo voto repetido é idempotente (1 linha, mesma nota)", async () => {
    const v = await checkedIn("c_idem");
    await liveOn(a);
    await castLiveVote(H, v.id, a, 4);
    await castLiveVote(H, v.id, a, 4);
    const t = await tallyFor(H, a);
    expect(t).toEqual({ count: 1, sum: 4, avg: 4, dist: [0, 0, 0, 1, 0] });
  });
});

describe("ranking — escolha do público", () => {
  async function votes(teamId: number, scores: number[]) {
    await goToTeam(H, teamId);
    await setVoting(H, true);
    for (const [i, s] of scores.entries()) {
      const m = await checkedIn(`c_r_${i}`);
      await castLiveVote(H, m.id, teamId, s);
    }
    await setVoting(H, false);
  }

  it("ordena pela média; empate aparece com a mesma posição; sem voto vai pro fim", async () => {
    await setQueue(H, [a, b, c]);
    await votes(a, [4, 4]); // 4.00 com 2
    await votes(b, [5, 3, 4, 4]); // 4.00 com 4 → empata com Alfa
    const r = await liveRanking(H);
    expect(r.map((e) => [e.teamName, e.position, e.tied, e.avg, e.votes])).toEqual([
      ["Beta", 1, true, 4, 4],
      ["Alfa", 1, true, 4, 2],
      ["Gama", 3, false, null, 0],
    ]);
  });

  it("médias diferentes não empatam", async () => {
    await setQueue(H, [a, b]);
    await votes(a, [5, 4]); // 4.5
    await votes(b, [5, 5, 3]); // 4.33
    const r = await liveRanking(H);
    expect(r.map((e) => [e.teamName, e.position, e.tied])).toEqual([
      ["Alfa", 1, false],
      ["Beta", 2, false],
    ]);
  });

  it("snapshot público só mostra o ranking depois de encerrar; ficha do projeto idem", async () => {
    await setQueue(H, [a, b]);
    await votes(a, [5]);
    expect((await getStageSnapshot(H)).ranking).toBeNull();
    expect(await getAudienceResult(a)).toBeNull();
    await endStage(H);
    const snap = await getStageSnapshot(H);
    expect(snap.status).toBe("ended");
    expect(snap.ranking?.[0]).toMatchObject({ teamId: a, position: 1 });
    expect(await getAudienceResult(a)).toEqual({ position: 1, avg: 5, votes: 1, tied: false, total: 1 });
    expect(await getAudienceResult(b)).toBeNull(); // sem voto, sem selo
  });

  it("encerrar é idempotente; reabrir volta ao vivo sem ninguém no palco", async () => {
    await setQueue(H, [a]);
    await expect(endStage(H)).rejects.toMatchObject({ status: 409 }); // nem começou
    await advanceStage(H, 1);
    await endStage(H);
    expect((await endStage(H)).status).toBe("ended");
    await expect(advanceStage(H, 1)).rejects.toMatchObject({ status: 409 });
    const s = await reopenStage(H);
    expect(s).toMatchObject({ status: "live", currentTeamId: null });
    await expect(reopenStage(H)).rejects.toMatchObject({ status: 409 });
  });
});

describe("snapshot e ações", () => {
  it("snapshot traz time atual, posição, próximos e placar; chave ignora o relógio", async () => {
    const v = await checkedIn("c_s");
    await liveOn(b);
    await castLiveVote(H, v.id, b, 3);
    const t0 = new Date("2026-10-17T20:00:00.000Z");
    const s1 = await getStageSnapshot(H, t0);
    expect(s1.current).toMatchObject({ teamId: b, teamName: "Beta", title: "Projeto Beta", position: 2 });
    expect(s1.total).toBe(3);
    expect(s1.upNext.map((t) => t.teamName)).toEqual(["Gama"]);
    expect(s1.tally).toMatchObject({ count: 1, avg: 3, dist: [0, 0, 1, 0, 0] });
    const s2 = await getStageSnapshot(H, new Date(t0.getTime() + 3000));
    expect(snapshotKey(s2)).toBe(snapshotKey(s1));
  });

  it("runStageAction valida ação e from", async () => {
    await expect(runStageAction(H, { action: "explodir" })).rejects.toMatchObject({ status: 400 });
    await expect(runStageAction(H, { action: "next", from: "x" })).rejects.toMatchObject({ status: 400 });
    await runStageAction(H, { action: "queue", teamIds: [a, b] });
    await runStageAction(H, { action: "next", from: null });
    await expect(runStageAction(H, { action: "next", from: null })).rejects.toMatchObject({ status: 409 });
    expect((await getSession(H)).currentTeamId).toBe(a);
  });
});
