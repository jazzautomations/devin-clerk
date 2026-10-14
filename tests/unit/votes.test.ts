import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { listProjects } from "@/lib/projects";
import {
  getVoteCounts,
  hasVoted,
  toggleVote,
  voteCountFor,
  VoteError,
} from "@/lib/votes";

// escolha do povo — spec 025: um voto por membro por projeto, toggle,
// sinal separado do pódio do júri (placement).

const UNIFACENS = "hack-inova-unifacens-2026";
const PUC = "hack-inova-puc-saude-2026";

async function memberId(username: string): Promise<number> {
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE username = ?").get(username) as {
      id: number;
    }
  ).id;
}

async function teamWithProject(
  hackathonId: string,
  name: string,
  memberUsernames: string[] = [],
  placement = 0,
): Promise<number> {
  return (await createTeam(hackathonId, {
    name,
    placement,
    memberUsernames,
    project: { title: `${name} app` },
  })).team.id;
}

beforeEach(async () => {
  await db.exec("DELETE FROM votes");
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
});

describe("toggleVote — um voto por membro por projeto", () => {
  it("liga e desliga: voted true → false, contagem sobe e desce", async () => {
    const voter = await memberId("voter");
    const teamId = await teamWithProject(UNIFACENS, "Alvo");

    expect(await toggleVote(voter, teamId)).toEqual({ voted: true });
    expect(await hasVoted(voter, teamId)).toBe(true);
    expect(await voteCountFor(teamId)).toBe(1);

    expect(await toggleVote(voter, teamId)).toEqual({ voted: false });
    expect(await hasVoted(voter, teamId)).toBe(false);
    expect(await voteCountFor(teamId)).toBe(0);
  });

  it("PK (memberId, teamId) garante dedupe: sequência de toggles nunca passa de 1 voto", async () => {
    const voter = await memberId("voter");
    const teamId = await teamWithProject(UNIFACENS, "Alvo");

    await toggleVote(voter, teamId);
    await toggleVote(voter, teamId);
    await toggleVote(voter, teamId);
    expect(await voteCountFor(teamId)).toBe(1);

    const rows = await db
      .prepare("SELECT COUNT(*) n FROM votes WHERE memberId = ? AND teamId = ?")
      .get(voter, teamId) as { n: number };
    expect(rows.n).toBe(1);
  });

  it("membros diferentes somam no mesmo projeto", async () => {
    const a = await memberId("ana");
    const b = await memberId("bia");
    const teamId = await teamWithProject(UNIFACENS, "Alvo");
    await toggleVote(a, teamId);
    await toggleVote(b, teamId);
    expect(await voteCountFor(teamId)).toBe(2);
  });

  it("403 — integrante não vota no próprio time (team_members por username)", async () => {
    await memberId("dono");
    const teamId = await teamWithProject(UNIFACENS, "MeuTime", ["dono"]);
    const dono = await memberId("dono");

    await expect(toggleVote(dono, teamId)).rejects.toThrowError(VoteError);
    try {
      await toggleVote(dono, teamId);
    } catch (e) {
      expect((e as VoteError).status).toBe(403);
      expect((e as VoteError).message).toContain("próprio time");
    }
    expect(await voteCountFor(teamId)).toBe(0);
  });

  it("mas integrante vota normalmente no time dos outros", async () => {
    await memberId("dev_a");
    const meu = await teamWithProject(UNIFACENS, "TimeA", ["dev_a"]);
    const deles = await teamWithProject(UNIFACENS, "TimeB");
    const a = await memberId("dev_a");

    await expect(toggleVote(a, meu)).rejects.toThrowError(VoteError);
    expect(await toggleVote(a, deles)).toEqual({ voted: true });
  });

  it("404 — teamId inexistente, e time sem projeto não é votável", async () => {
    const voter = await memberId("voter");
    await expect(toggleVote(voter, 999999)).rejects.toThrowError(VoteError);
    try {
      await toggleVote(voter, 999999);
    } catch (e) {
      expect((e as VoteError).status).toBe(404);
    }

    const semProjeto = (await createTeam(UNIFACENS, {
      name: "SemProjeto",
      placement: 0,
    })).team.id;
    await expect(toggleVote(voter, semProjeto)).rejects.toThrowError(VoteError);
    expect(await voteCountFor(semProjeto)).toBe(0);
  });
});

describe("placar — voteCountFor / getVoteCounts", () => {
  it("voteCountFor conta por teamId; getVoteCounts agrega listas", async () => {
    const a = await memberId("ana");
    const b = await memberId("bia");
    const t1 = await teamWithProject(UNIFACENS, "Um");
    const t2 = await teamWithProject(PUC, "Dois");
    const t3 = await teamWithProject(PUC, "Tres");

    await toggleVote(a, t1);
    await toggleVote(b, t1);
    await toggleVote(a, t2);

    expect(await voteCountFor(t1)).toBe(2);
    expect(await voteCountFor(t3)).toBe(0);

    const counts = await getVoteCounts([t1, t2, t3]);
    expect(counts.get(t1)).toBe(2);
    expect(counts.get(t2)).toBe(1);
    expect(counts.get(t3) ?? 0).toBe(0);
    expect((await getVoteCounts([])).size).toBe(0);
  });
});

describe("listProjects — placar do povo no índice", () => {
  it("cards trazem voteCount e votedByMe (meId)", async () => {
    await memberId("eu");
    const eu = await memberId("eu");
    const outro = await memberId("outro");
    const t1 = await teamWithProject(UNIFACENS, "Um");
    const t2 = await teamWithProject(UNIFACENS, "Dois");
    await toggleVote(eu, t1);
    await toggleVote(outro, t1);
    await toggleVote(outro, t2);

    const anon = Object.fromEntries(
      (await listProjects()).map((c) => [c.teamId, c]),
    );
    expect(anon[t1].voteCount).toBe(2);
    expect(anon[t1].votedByMe).toBe(false); // anon nunca "votou"

    const mine = Object.fromEntries(
      (await listProjects({ meId: eu })).map((c) => [c.teamId, c]),
    );
    expect(mine[t1].votedByMe).toBe(true);
    expect(mine[t2].votedByMe).toBe(false);
    expect(mine[t2].voteCount).toBe(1);
  });

  it('sort "votes" rankeia por votos desc — participante mais votado passa o campeão', async () => {
    const a = await memberId("ana");
    const b = await memberId("bia");
    const campeao = await teamWithProject(UNIFACENS, "Campeao", [], 1);
    const queridinho = await teamWithProject(UNIFACENS, "Queridinho");
    const zero = await teamWithProject(UNIFACENS, "Zero");

    await toggleVote(a, queridinho);
    await toggleVote(b, queridinho);
    await toggleVote(a, campeao);

    const juryOrder = (await listProjects()).map((c) => c.teamId);
    expect(juryOrder[0]).toBe(campeao); // default segue sendo o júri

    const votesOrder = (await listProjects({ sort: "votes" })).map((c) => c.teamId);
    expect(votesOrder[0]).toBe(queridinho);
    expect(votesOrder[1]).toBe(campeao);
    expect(votesOrder[2]).toBe(zero);
  });
});

describe("voto popular × entrega (spec 034)", () => {
  it("edição com prazo de entrega: projeto sem versão enviada não recebe voto", async () => {
    const h = "voto-entrega-h";
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, submissionDeadline)
         VALUES (?, 'Voto Entrega', 'Hack Inova', '2099-01-01', 'presencial', 'https://x.dev', '2099-01-02 12:00:00')
         ON CONFLICT (id) DO NOTHING`,
      )
      .run(h);
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Rascunho FC') RETURNING id")
      .get<{ id: number }>(h);
    await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, 'Ainda em rascunho')").run(t!.id);
    const voter = await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES ('c_vt_entrega', 'vtentrega', 'v@e.dev') RETURNING id")
      .get<{ id: number }>();
    await expect(toggleVote(voter!.id, t!.id)).rejects.toThrow(/não encontrado/);
  });
});
