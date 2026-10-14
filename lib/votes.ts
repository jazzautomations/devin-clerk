import db from "@/lib/db";
import { isEligibleForVoting } from "@/lib/entries";

// escolha do povo (spec 025): um voto por membro por projeto, em toggle.
// voto é sinal separado do placement — o pódio segue sendo do júri.
// erro de domínio com status HTTP — a rota mapeia sem parsear mensagem
// (pattern TeamError de lib/teams.ts)
export class VoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// "projeto votável" = time com linha em team_projects — mesmo gate da
// ficha /p/[teamId] e do índice /projetos (votar no invisível não vale)
async function hasProject(teamId: number): Promise<boolean> {
  return !!await db
    .prepare("SELECT 1 FROM team_projects WHERE teamId = ?")
    .get(teamId);
}

// vínculo é por username (team_members não guarda memberId) — quem tá no
// time não vota nele: voto é sinal da comunidade, não autopromoção
async function isTeamMember(teamId: number, memberId: number): Promise<boolean> {
  return !!await db
    .prepare(
      `SELECT 1 FROM team_members tm
       JOIN members m ON m.username = tm.username
       WHERE tm.teamId = ? AND m.id = ?`,
    )
    .get(teamId, memberId);
}

export async function hasVoted(memberId: number, teamId: number): Promise<boolean> {
  return !!await db
    .prepare("SELECT 1 FROM votes WHERE memberId = ? AND teamId = ?")
    .get(memberId, teamId);
}

export async function voteCountFor(teamId: number): Promise<number> {
  return (
    await db
      .prepare("SELECT COUNT(*) AS n FROM votes WHERE teamId = ?")
      .get(teamId) as { n: number }
  ).n;
}

/** placar em lote pra listas — time sem voto simplesmente não entra no mapa */
export async function getVoteCounts(teamIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (teamIds.length === 0) return counts;
  const rows = await db
    .prepare(
      `SELECT teamId, COUNT(*) AS n FROM votes
       WHERE teamId = ANY(?)
       GROUP BY teamId`,
    )
    .all(teamIds) as { teamId: number; n: number }[];
  for (const r of rows) counts.set(r.teamId, r.n);
  return counts;
}

// toggle: vota quando não votou, desvota quando já votou — a PK faz o
// dedupe físico, então retry/duplo clique nunca infla o placar
export async function toggleVote(
  memberId: number,
  teamId: number,
): Promise<{ voted: boolean }> {
  // fluxo de entrega (spec 034): só projeto enviado entra no voto; edição sem
  // prazo de entrega continua no modo antigo (basta ter projeto)
  if (!Number.isInteger(teamId) || !await hasProject(teamId) || !await isEligibleForVoting(teamId)) {
    throw new VoteError("projeto não encontrado", 404);
  }
  if (await isTeamMember(teamId, memberId)) {
    throw new VoteError("não dá pra votar no teu próprio time", 403);
  }
  if (await hasVoted(memberId, teamId)) {
    await db.prepare("DELETE FROM votes WHERE memberId = ? AND teamId = ?").run(
      memberId,
      teamId,
    );
    return { voted: false };
  }
  await db.prepare(
    "INSERT INTO votes (memberId, teamId, createdAt) VALUES (?, ?, ?)",
  ).run(memberId, teamId, new Date().toISOString());
  return { voted: true };
}
