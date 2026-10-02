import db from "@/lib/db";

// schema próprio (idempotente) — não edita lib/db.ts (pattern lib/leads.ts)
// escolha do povo (spec 025): um voto por membro por projeto, em toggle.
// voto é sinal separado do placement — o pódio segue sendo do júri.
db.exec(`CREATE TABLE IF NOT EXISTS votes (
  memberId INTEGER NOT NULL REFERENCES members(id),
  teamId INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (memberId, teamId)
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_votes_team ON votes(teamId)");

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
function hasProject(teamId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM team_projects WHERE teamId = ?")
    .get(teamId);
}

// vínculo é por username (team_members não guarda memberId) — quem tá no
// time não vota nele: voto é sinal da comunidade, não autopromoção
function isTeamMember(teamId: number, memberId: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM team_members tm
       JOIN members m ON m.username = tm.username
       WHERE tm.teamId = ? AND m.id = ?`,
    )
    .get(teamId, memberId);
}

export function hasVoted(memberId: number, teamId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM votes WHERE memberId = ? AND teamId = ?")
    .get(memberId, teamId);
}

export function voteCountFor(teamId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM votes WHERE teamId = ?")
      .get(teamId) as { n: number }
  ).n;
}

/** placar em lote pra listas — time sem voto simplesmente não entra no mapa */
export function getVoteCounts(teamIds: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  if (teamIds.length === 0) return counts;
  const rows = db
    .prepare(
      `SELECT teamId, COUNT(*) AS n FROM votes
       WHERE teamId IN (SELECT value FROM json_each(?))
       GROUP BY teamId`,
    )
    .all(JSON.stringify(teamIds)) as { teamId: number; n: number }[];
  for (const r of rows) counts.set(r.teamId, r.n);
  return counts;
}

// toggle: vota quando não votou, desvota quando já votou — a PK faz o
// dedupe físico, então retry/duplo clique nunca infla o placar
export function toggleVote(
  memberId: number,
  teamId: number,
): { voted: boolean } {
  if (!Number.isInteger(teamId) || !hasProject(teamId)) {
    throw new VoteError("projeto não encontrado", 404);
  }
  if (isTeamMember(teamId, memberId)) {
    throw new VoteError("não dá pra votar no teu próprio time", 403);
  }
  if (hasVoted(memberId, teamId)) {
    db.prepare("DELETE FROM votes WHERE memberId = ? AND teamId = ?").run(
      memberId,
      teamId,
    );
    return { voted: false };
  }
  db.prepare(
    "INSERT INTO votes (memberId, teamId, createdAt) VALUES (?, ?, ?)",
  ).run(memberId, teamId, new Date().toISOString());
  return { voted: true };
}
