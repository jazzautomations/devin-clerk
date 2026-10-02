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

function memberId(username: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${username}`, username, `${username}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE username = ?").get(username) as {
      id: number;
    }
  ).id;
}

function teamWithProject(
  hackathonId: string,
  name: string,
  memberUsernames: string[] = [],
  placement = 0,
): number {
  return createTeam(hackathonId, {
    name,
    placement,
    memberUsernames,
    project: { title: `${name} app` },
  }).team.id;
}

beforeEach(() => {
  db.exec("DELETE FROM votes");
  db.exec("DELETE FROM team_members");
  db.exec("DELETE FROM team_projects");
  db.exec("DELETE FROM teams");
});

describe("toggleVote — um voto por membro por projeto", () => {
  it("liga e desliga: voted true → false, contagem sobe e desce", () => {
    const voter = memberId("voter");
    const teamId = teamWithProject(UNIFACENS, "Alvo");

    expect(toggleVote(voter, teamId)).toEqual({ voted: true });
    expect(hasVoted(voter, teamId)).toBe(true);
    expect(voteCountFor(teamId)).toBe(1);

    expect(toggleVote(voter, teamId)).toEqual({ voted: false });
    expect(hasVoted(voter, teamId)).toBe(false);
    expect(voteCountFor(teamId)).toBe(0);
  });

  it("PK (memberId, teamId) garante dedupe: sequência de toggles nunca passa de 1 voto", () => {
    const voter = memberId("voter");
    const teamId = teamWithProject(UNIFACENS, "Alvo");

    toggleVote(voter, teamId);
    toggleVote(voter, teamId);
    toggleVote(voter, teamId);
    expect(voteCountFor(teamId)).toBe(1);

    const rows = db
      .prepare("SELECT COUNT(*) n FROM votes WHERE memberId = ? AND teamId = ?")
      .get(voter, teamId) as { n: number };
    expect(rows.n).toBe(1);
  });

  it("membros diferentes somam no mesmo projeto", () => {
    const a = memberId("ana");
    const b = memberId("bia");
    const teamId = teamWithProject(UNIFACENS, "Alvo");
    toggleVote(a, teamId);
    toggleVote(b, teamId);
    expect(voteCountFor(teamId)).toBe(2);
  });

  it("403 — integrante não vota no próprio time (team_members por username)", () => {
    memberId("dono");
    const teamId = teamWithProject(UNIFACENS, "MeuTime", ["dono"]);
    const dono = memberId("dono");

    expect(() => toggleVote(dono, teamId)).toThrowError(VoteError);
    try {
      toggleVote(dono, teamId);
    } catch (e) {
      expect((e as VoteError).status).toBe(403);
      expect((e as VoteError).message).toContain("próprio time");
    }
    expect(voteCountFor(teamId)).toBe(0);
  });

  it("mas integrante vota normalmente no time dos outros", () => {
    memberId("dev_a");
    const meu = teamWithProject(UNIFACENS, "TimeA", ["dev_a"]);
    const deles = teamWithProject(UNIFACENS, "TimeB");
    const a = memberId("dev_a");

    expect(() => toggleVote(a, meu)).toThrowError(VoteError);
    expect(toggleVote(a, deles)).toEqual({ voted: true });
  });

  it("404 — teamId inexistente, e time sem projeto não é votável", () => {
    const voter = memberId("voter");
    expect(() => toggleVote(voter, 999999)).toThrowError(VoteError);
    try {
      toggleVote(voter, 999999);
    } catch (e) {
      expect((e as VoteError).status).toBe(404);
    }

    const semProjeto = createTeam(UNIFACENS, {
      name: "SemProjeto",
      placement: 0,
    }).team.id;
    expect(() => toggleVote(voter, semProjeto)).toThrowError(VoteError);
    expect(voteCountFor(semProjeto)).toBe(0);
  });
});

describe("placar — voteCountFor / getVoteCounts", () => {
  it("voteCountFor conta por teamId; getVoteCounts agrega listas", () => {
    const a = memberId("ana");
    const b = memberId("bia");
    const t1 = teamWithProject(UNIFACENS, "Um");
    const t2 = teamWithProject(PUC, "Dois");
    const t3 = teamWithProject(PUC, "Tres");

    toggleVote(a, t1);
    toggleVote(b, t1);
    toggleVote(a, t2);

    expect(voteCountFor(t1)).toBe(2);
    expect(voteCountFor(t3)).toBe(0);

    const counts = getVoteCounts([t1, t2, t3]);
    expect(counts.get(t1)).toBe(2);
    expect(counts.get(t2)).toBe(1);
    expect(counts.get(t3) ?? 0).toBe(0);
    expect(getVoteCounts([]).size).toBe(0);
  });
});

describe("listProjects — placar do povo no índice", () => {
  it("cards trazem voteCount e votedByMe (meId)", () => {
    memberId("eu");
    const eu = memberId("eu");
    const outro = memberId("outro");
    const t1 = teamWithProject(UNIFACENS, "Um");
    const t2 = teamWithProject(UNIFACENS, "Dois");
    toggleVote(eu, t1);
    toggleVote(outro, t1);
    toggleVote(outro, t2);

    const anon = Object.fromEntries(
      listProjects().map((c) => [c.teamId, c]),
    );
    expect(anon[t1].voteCount).toBe(2);
    expect(anon[t1].votedByMe).toBe(false); // anon nunca "votou"

    const mine = Object.fromEntries(
      listProjects({ meId: eu }).map((c) => [c.teamId, c]),
    );
    expect(mine[t1].votedByMe).toBe(true);
    expect(mine[t2].votedByMe).toBe(false);
    expect(mine[t2].voteCount).toBe(1);
  });

  it('sort "votes" rankeia por votos desc — participante mais votado passa o campeão', () => {
    const a = memberId("ana");
    const b = memberId("bia");
    const campeao = teamWithProject(UNIFACENS, "Campeao", [], 1);
    const queridinho = teamWithProject(UNIFACENS, "Queridinho");
    const zero = teamWithProject(UNIFACENS, "Zero");

    toggleVote(a, queridinho);
    toggleVote(b, queridinho);
    toggleVote(a, campeao);

    const juryOrder = listProjects().map((c) => c.teamId);
    expect(juryOrder[0]).toBe(campeao); // default segue sendo o júri

    const votesOrder = listProjects({ sort: "votes" }).map((c) => c.teamId);
    expect(votesOrder[0]).toBe(queridinho);
    expect(votesOrder[1]).toBe(campeao);
    expect(votesOrder[2]).toBe(zero);
  });
});
