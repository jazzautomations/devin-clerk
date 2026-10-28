import db from "@/lib/db";
import { canManageCommunity, cleanUrl, isCommunityOwner } from "@/lib/communities";
import { parseEventTime, toEventIso } from "@/lib/eventTime";
import { communityAudience } from "@/lib/follows";
import type { Member } from "@/lib/members";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";
import { currentMember } from "@/lib/session";

// Desafios abertos entre edições (migration 053, spec 046 onda 5).
//
// POR QUE TABELA NOVA: challenges (001) é o catálogo de desafios de
// patrocinador ligado à edição por project_challenges, e o júri e a
// premiação da edição leem dali. Desafio aberto não tem edição, inscrição
// nem júri: tem prazo e entrega próprios. Pôr communityId em challenges
// obrigaria todo o código de edição a tratar desafio sem edição.
//
// Regras:
// - cria: dono, organizador da comunidade ou admin global (rascunho ou já
//   publicado). Publicar avisa membros e seguidores da comunidade.
// - entrega: qualquer pessoa logada que passe em canNetwork, até o prazo
//   (horário de Brasília). Quem organiza a comunidade não entrega no desafio
//   dela. teamId só de time em que a pessoa está; repo e demo só https.
// - "encerrado" é calculado na leitura (status 'aberto' + prazo vencido),
//   sem cron. Encerrado não aceita entrega.
// - entregas ficam escondidas até o prazo (até de quem criou); antes disso
//   só a contagem. Cada pessoa vê a própria.
// - resultado: quem criou (ou o dono da comunidade, se quem criou saiu)
//   marca 1º a 3º depois do prazo e publica; cada participante é avisado.
// - IA não julga nem ordena nada: a lista de entregas é por ordem de envio.

export const OPEN_CHALLENGE_STATUSES = ["rascunho", "aberto", "resultado"] as const;
export type OpenChallengeStatus = (typeof OPEN_CHALLENGE_STATUSES)[number];
/** o que a tela mostra: status gravado + "encerrado" calculado pelo prazo */
export type OpenChallengePhase = "rascunho" | "aberto" | "encerrado" | "resultado";

export const OPEN_CHALLENGE_LIMITS = {
  title: 100,
  brief: 3000,
  rules: 3000,
  prize: 200,
  sponsorName: 80,
  summary: 1000,
  url: 300,
} as const;

/** prazo: no mínimo 1 hora à frente, no máximo 1 ano */
const MIN_LEAD_MS = 60 * 60 * 1000;
const MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** entregar e tirar entrega: balde próprio (o 'open-challenges' de lib/ratelimit é o de criar) */
export const ENTRY_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

export const DEADLINE_PASSED = "O prazo deste desafio acabou. Não dá mais pra entregar.";

export const PLACE_LABELS: Record<number, string> = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };

export class OpenChallengeError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export type OpenChallenge = {
  id: number;
  communityId: number;
  communitySlug: string;
  communityName: string;
  communityHidden: boolean;
  sponsorName: string | null;
  title: string;
  brief: string;
  rules: string | null;
  prize: string | null;
  /** "2026-11-14T23:59:00-03:00" */
  deadline: string;
  status: OpenChallengeStatus;
  phase: OpenChallengePhase;
  createdBy: number;
  creatorUsername: string | null;
  createdAt: string;
  publishedAt: string | null;
  resultAt: string | null;
  entryCount: number;
};

type Row = Omit<OpenChallenge, "phase" | "communityHidden"> & { communityHidden: number };

/** fase do desafio agora: aberto com prazo vencido vira encerrado */
export function challengePhase(c: { status: OpenChallengeStatus; deadline: string }, now: Date = new Date()): OpenChallengePhase {
  if (c.status !== "aberto") return c.status;
  const d = parseEventTime(c.deadline);
  return d && d.getTime() <= now.getTime() ? "encerrado" : "aberto";
}

/** o prazo já passou? (aberto encerrado, resultado ou prazo ilegível) */
export function deadlinePassed(deadline: string, now: Date = new Date()): boolean {
  const d = parseEventTime(deadline);
  return !d || d.getTime() <= now.getTime();
}

const toChallenge = (r: Row, now = new Date()): OpenChallenge => ({
  ...r,
  communityHidden: r.communityHidden === 1,
  phase: challengePhase(r, now),
});

const SELECT = `
  SELECT oc.id, oc.communityId, c.slug AS communitySlug, c.name AS communityName, c.hidden AS communityHidden,
         oc.sponsorName, oc.title, oc.brief, oc.rules, oc.prize, oc.deadline, oc.status, oc.createdBy,
         m.username AS creatorUsername, oc.createdAt, oc.publishedAt, oc.resultAt,
         (SELECT COUNT(*) FROM open_challenge_entries e WHERE e.challengeId = oc.id) AS entryCount
  FROM open_challenges oc
  JOIN communities c ON c.id = oc.communityId
  LEFT JOIN members m ON m.id = oc.createdBy`;

// ---------- validação ----------

export type OpenChallengeInput = {
  title: string;
  brief: string;
  rules: string | null;
  prize: string | null;
  sponsorName: string | null;
  deadline: string;
};

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");
const optional = (v: unknown): string | null => text(v) || null;

/**
 * Corpo do formulário → desafio válido. O prazo chega do
 * <input type="datetime-local"> (horário de Brasília) e sai com o offset
 * explícito. `now` existe pros testes.
 */
export function parseOpenChallengeInput(
  raw: unknown,
  now: Date = new Date(),
): { value: OpenChallengeInput } | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const L = OPEN_CHALLENGE_LIMITS;
  const title = text(b.title).replace(/\s+/g, " ");
  const brief = text(b.brief);
  const rules = optional(b.rules);
  const prize = optional(b.prize)?.replace(/\s+/g, " ") ?? null;
  const sponsorName = optional(b.sponsorName)?.replace(/\s+/g, " ") ?? null;
  if (!title) return { error: "Dê um título ao desafio." };
  if (title.length > L.title) return { error: `Título até ${L.title} caracteres.` };
  if (!brief) return { error: "Escreva o que é pra construir." };
  if (brief.length > L.brief) return { error: `Descrição até ${L.brief} caracteres.` };
  if (rules && rules.length > L.rules) return { error: `Regras até ${L.rules} caracteres.` };
  if (prize && prize.length > L.prize) return { error: `Prêmio até ${L.prize} caracteres.` };
  if (sponsorName && sponsorName.length > L.sponsorName) return { error: `Patrocinador até ${L.sponsorName} caracteres.` };
  const d = typeof b.deadline === "string" ? parseEventTime(b.deadline) : null;
  if (!d) return { error: "Escolha o prazo de entrega." };
  if (d.getTime() < now.getTime() + MIN_LEAD_MS) return { error: "O prazo precisa ser pelo menos 1 hora à frente." };
  if (d.getTime() > now.getTime() + MAX_LEAD_MS) return { error: "O prazo vai até 1 ano à frente." };
  return { value: { title, brief, rules, prize, sponsorName, deadline: toEventIso(d) } };
}

export type EntryInput = { teamId: number | null; repoUrl: string | null; demoUrl: string | null; summary: string };

export function parseEntryInput(raw: unknown): { value: EntryInput } | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const summary = text(b.summary);
  if (!summary) return { error: "Conte em poucas linhas o que você fez." };
  if (summary.length > OPEN_CHALLENGE_LIMITS.summary) return { error: `Resumo até ${OPEN_CHALLENGE_LIMITS.summary} caracteres.` };
  let teamId: number | null = null;
  if (b.teamId !== undefined && b.teamId !== null && b.teamId !== "") {
    const n = Number(b.teamId);
    if (!Number.isInteger(n) || n <= 0) return { error: "Projeto inválido." };
    teamId = n;
  }
  const links: Record<"repoUrl" | "demoUrl", string | null> = { repoUrl: null, demoUrl: null };
  for (const k of ["repoUrl", "demoUrl"] as const) {
    const r = cleanUrl(b[k], { httpsOnly: true });
    if ("error" in r) return { error: k === "repoUrl" ? "O repo precisa de link https://" : "A demo precisa de link https://" };
    links[k] = r.value;
  }
  if (!teamId && !links.repoUrl) return { error: "Escolha um projeto seu do HackaHub ou cole o link do repo." };
  return { value: { teamId, ...links, summary } };
}

// ---------- permissões ----------

type Actor = Pick<Member, "id" | "role">;

/** edita rascunho, publica e apaga rascunho: quem gerencia a comunidade */
export async function canEditChallenge(actor: Actor | null, c: Pick<OpenChallenge, "communityId">): Promise<boolean> {
  return canManageCommunity(actor, c.communityId);
}

/** escolhe vencedores: quem criou, ou o dono da comunidade (ou admin) */
export async function canJudgeChallenge(actor: Actor | null, c: Pick<OpenChallenge, "communityId" | "createdBy">): Promise<boolean> {
  if (!actor) return false;
  if (actor.id === c.createdBy) return true;
  return isCommunityOwner(actor, c.communityId);
}

/**
 * Quem pode ver o desafio: publicado de comunidade visível, pra qualquer
 * conta; rascunho só pra quem gerencia; comunidade escondida só pro admin.
 */
export async function canSeeChallenge(actor: Actor | null, c: OpenChallenge): Promise<boolean> {
  if (!actor) return false;
  if (c.communityHidden && actor.role !== "admin") return false;
  if (c.status === "rascunho") return canEditChallenge(actor, c);
  return true;
}

// ---------- leitura ----------

export async function getOpenChallenge(id: number): Promise<OpenChallenge | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await db.prepare(`${SELECT} WHERE oc.id = ?`).get<Row>(id);
  return r ? toChallenge(r) : null;
}

/**
 * /desafios: os abertos com o prazo mais próximo primeiro e os encerrados
 * (com resultado ou esperando) do mais recente pro mais antigo. Só
 * comunidade visível; rascunho nunca entra.
 */
export async function listOpenChallenges(opts: { communityId?: number | null; limitClosed?: number } = {}): Promise<{
  open: OpenChallenge[];
  closed: OpenChallenge[];
}> {
  const now = new Date();
  const rows = await db
    .prepare(
      `${SELECT}
       WHERE oc.status <> 'rascunho' AND c.hidden = 0
         AND (?::int IS NULL OR oc.communityId = ?::int)
       ORDER BY to_ts(oc.deadline) ASC, oc.id ASC`,
    )
    .all<Row>(opts.communityId ?? null, opts.communityId ?? null);
  const all = rows.map((r) => toChallenge(r, now));
  const open = all.filter((c) => c.phase === "aberto");
  const closed = all
    .filter((c) => c.phase !== "aberto")
    .sort((a, b) => (parseEventTime(b.deadline)?.getTime() ?? 0) - (parseEventTime(a.deadline)?.getTime() ?? 0))
    .slice(0, opts.limitClosed ?? 30);
  return { open, closed };
}

/** comunidades com desafio publicado: os chips de filtro do /desafios */
export async function challengeCommunities(): Promise<{ slug: string; name: string; id: number }[]> {
  return db
    .prepare(
      `SELECT DISTINCT c.id, c.slug, c.name FROM communities c
       JOIN open_challenges oc ON oc.communityId = c.id
       WHERE oc.status <> 'rascunho' AND c.hidden = 0
       ORDER BY c.name`,
    )
    .all<{ slug: string; name: string; id: number }>();
}

/** rascunhos da comunidade, pra quem gerencia continuar de onde parou */
export async function listDrafts(communityId: number): Promise<OpenChallenge[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE oc.communityId = ? AND oc.status = 'rascunho' ORDER BY oc.id DESC`)
    .all<Row>(communityId);
  return rows.map((r) => toChallenge(r));
}

/** comunidades em que a pessoa pode criar desafio (dono ou organizador) */
export async function communitiesICanChallenge(memberId: number): Promise<{ slug: string; name: string }[]> {
  return db
    .prepare(
      `SELECT c.slug, c.name FROM community_members cm JOIN communities c ON c.id = cm.communityId
       WHERE cm.memberId = ? AND cm.role IN ('dono', 'organizador') AND c.hidden = 0
       ORDER BY c.name`,
    )
    .all<{ slug: string; name: string }>(memberId);
}

export type OpenChallengeEntry = {
  id: number;
  memberId: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  teamId: number | null;
  projectTitle: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  summary: string;
  submittedAt: string;
  place: number | null;
};

const ENTRY_SELECT = `
  SELECT e.id, e.memberId, m.username, m.name, m.avatarUrl, e.teamId, tp.title AS projectTitle,
         e.repoUrl, e.demoUrl, e.summary, e.submittedAt, e.place
  FROM open_challenge_entries e
  JOIN members m ON m.id = e.memberId
  LEFT JOIN team_projects tp ON tp.teamId = e.teamId`;

/** todas as entregas, por colocação e depois por ordem de envio (nunca por nota) */
export async function listEntries(challengeId: number): Promise<OpenChallengeEntry[]> {
  return db
    .prepare(`${ENTRY_SELECT} WHERE e.challengeId = ? ORDER BY e.place ASC NULLS LAST, e.submittedAt ASC, e.id ASC`)
    .all<OpenChallengeEntry>(challengeId);
}

export async function myEntry(challengeId: number, memberId: number): Promise<OpenChallengeEntry | null> {
  const r = await db.prepare(`${ENTRY_SELECT} WHERE e.challengeId = ? AND e.memberId = ?`).get<OpenChallengeEntry>(challengeId, memberId);
  return r ?? null;
}

/**
 * O que quem vê a página pode ler das entregas. Antes do prazo: só a
 * contagem e a própria. Depois: todas. Rascunho não tem entrega.
 */
export async function visibleEntries(
  c: OpenChallenge,
  viewerId: number | null,
): Promise<{ count: number; entries: OpenChallengeEntry[] | null; mine: OpenChallengeEntry | null }> {
  const mine = viewerId ? await myEntry(c.id, viewerId) : null;
  if (c.phase === "aberto" || c.phase === "rascunho") return { count: c.entryCount, entries: null, mine };
  return { count: c.entryCount, entries: await listEntries(c.id), mine };
}

export type EntryTeam = { teamId: number; teamName: string; projectTitle: string; hackathonName: string };

/** times com projeto em que a pessoa está: as opções de "projeto do HackaHub" */
export async function myProjectTeams(username: string): Promise<EntryTeam[]> {
  return db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, tp.title AS projectTitle, h.name AS hackathonName
       FROM team_members tm
       JOIN teams t ON t.id = tm.teamId
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE tm.username = ?
       ORDER BY t.id DESC`,
    )
    .all<EntryTeam>(username);
}

// ---------- escrita ----------

/** cria o desafio (rascunho) e publica já se pedido. Quem chama checou o papel. */
export async function createOpenChallenge(
  communityId: number,
  author: Pick<Member, "id" | "username">,
  input: OpenChallengeInput,
  opts: { publish?: boolean } = {},
): Promise<{ challenge: OpenChallenge; notified: number }> {
  const row = await db
    .prepare(
      `INSERT INTO open_challenges (communityId, sponsorName, title, brief, rules, prize, deadline, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(communityId, input.sponsorName, input.title, input.brief, input.rules, input.prize, input.deadline, author.id);
  let notified = 0;
  if (opts.publish) notified = (await publishOpenChallenge(row!.id, author)) ?? 0;
  return { challenge: (await getOpenChallenge(row!.id))!, notified };
}

/** edita o rascunho. Desafio publicado não muda: quem já começou a construir leu aquelas regras. */
export async function updateDraft(id: number, input: OpenChallengeInput): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE open_challenges SET sponsorName = ?, title = ?, brief = ?, rules = ?, prize = ?, deadline = ?
       WHERE id = ? AND status = 'rascunho'`,
    )
    .run(input.sponsorName, input.title, input.brief, input.rules, input.prize, input.deadline, id);
  return r.changes > 0;
}

export async function deleteDraft(id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM open_challenges WHERE id = ? AND status = 'rascunho'").run(id);
  return r.changes > 0;
}

/**
 * Rascunho → aberto, uma vez só (o UPDATE condicional segura dois cliques).
 * Avisa membros e seguidores da comunidade, menos quem publicou. null =
 * não estava em rascunho (já publicado) ou o prazo já passou.
 */
export async function publishOpenChallenge(id: number, actor: Pick<Member, "id" | "username">): Promise<number | null> {
  return db.transaction(async () => {
    const c = await db
      .prepare(
        `UPDATE open_challenges oc SET status = 'aberto', publishedAt = sqlite_now()
         FROM communities c
         WHERE oc.id = ? AND oc.status = 'rascunho' AND c.id = oc.communityId
           AND to_ts(oc.deadline) > now()
         RETURNING oc.id, oc.title, oc.communityId, c.name AS communityName, oc.sponsorName`,
      )
      .get<{ id: number; title: string; communityId: number; communityName: string; sponsorName: string | null }>(id);
    if (!c) return null;
    const ids = (await communityAudience(c.communityId)).filter((m) => m !== actor.id);
    const sponsor = c.sponsorName ? `, patrocinado por ${c.sponsorName}` : "";
    for (const memberId of ids) {
      await notify(memberId, {
        type: "desafio_aberto",
        actorId: actor.id,
        actorUsername: actor.username,
        text: `${c.communityName} abriu o desafio "${c.title}"${sponsor}.`,
        href: `/desafios/${c.id}`,
      });
    }
    return ids.length;
  })();
}

/**
 * Entrega (ou atualiza a própria) até o prazo. Erros com status HTTP:
 * 400 prazo/forma, 403 quem organiza a comunidade ou time alheio.
 */
export async function submitEntry(
  c: OpenChallenge,
  member: Pick<Member, "id" | "username" | "role">,
  input: EntryInput,
): Promise<OpenChallengeEntry> {
  if (c.status === "rascunho") throw new OpenChallengeError("Desafio não encontrado", 404);
  if (c.phase !== "aberto") throw new OpenChallengeError(DEADLINE_PASSED, 400);
  if (!(await canNetwork(member.id))) throw new OpenChallengeError("Sua conta não pode entregar em desafios.", 403);
  // admin global modera, não organiza: só dono e organizador da comunidade ficam de fora
  const role = await db
    .prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?")
    .get<{ role: string }>(c.communityId, member.id);
  if (member.id === c.createdBy || role?.role === "dono" || role?.role === "organizador") {
    throw new OpenChallengeError("Quem organiza a comunidade não entrega no desafio dela.", 403);
  }
  if (input.teamId) {
    const inTeam = await db
      .prepare(
        `SELECT 1 AS y FROM team_members tm JOIN team_projects tp ON tp.teamId = tm.teamId
         WHERE tm.teamId = ? AND tm.username = ?`,
      )
      .get<{ y: number }>(input.teamId, member.username);
    if (!inTeam) throw new OpenChallengeError("Esse projeto não é de um time seu.", 403);
  }
  // o prazo é conferido de novo no banco: a entrega que chega no último
  // segundo não passa por ter lido o desafio um instante antes
  const r = await db
    .prepare(
      `INSERT INTO open_challenge_entries (challengeId, memberId, teamId, repoUrl, demoUrl, summary)
       SELECT oc.id, ?, ?, ?, ?, ? FROM open_challenges oc
       WHERE oc.id = ? AND oc.status = 'aberto' AND to_ts(oc.deadline) > now()
       ON CONFLICT (challengeId, memberId) DO UPDATE SET
         teamId = EXCLUDED.teamId, repoUrl = EXCLUDED.repoUrl, demoUrl = EXCLUDED.demoUrl,
         summary = EXCLUDED.summary, submittedAt = sqlite_now()
       RETURNING id`,
    )
    .get<{ id: number }>(member.id, input.teamId, input.repoUrl, input.demoUrl, input.summary, c.id);
  if (!r) throw new OpenChallengeError(DEADLINE_PASSED, 400);
  return (await myEntry(c.id, member.id))!;
}

/** tira a própria entrega, só enquanto o prazo corre */
export async function withdrawEntry(c: OpenChallenge, memberId: number): Promise<boolean> {
  if (c.phase !== "aberto") throw new OpenChallengeError("O prazo acabou. A entrega fica como está.", 400);
  const r = await db
    .prepare(
      `DELETE FROM open_challenge_entries e USING open_challenges oc
       WHERE e.challengeId = ? AND e.memberId = ? AND oc.id = e.challengeId
         AND oc.status = 'aberto' AND to_ts(oc.deadline) > now()`,
    )
    .run(c.id, memberId);
  return r.changes > 0;
}

export type PlacePick = { entryId: number; place: number };

/** confere a escolha: 1º obrigatório, cada lugar uma vez, cada entrega uma vez */
export function parsePlaces(raw: unknown): { value: PlacePick[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Escolha pelo menos o 1º lugar." };
  const picks: PlacePick[] = [];
  for (const p of raw) {
    const entryId = Number((p as { entryId?: unknown })?.entryId);
    const place = Number((p as { place?: unknown })?.place);
    if (!Number.isInteger(entryId) || entryId <= 0 || ![1, 2, 3].includes(place)) return { error: "Colocação inválida." };
    picks.push({ entryId, place });
  }
  if (!picks.some((p) => p.place === 1)) return { error: "Escolha pelo menos o 1º lugar." };
  if (new Set(picks.map((p) => p.place)).size !== picks.length) return { error: "Cada colocação vai pra uma entrega só." };
  if (new Set(picks.map((p) => p.entryId)).size !== picks.length) return { error: "Uma entrega leva uma colocação só." };
  return { value: picks };
}

/**
 * Publica o resultado: grava as colocações, vira 'resultado' e avisa cada
 * participante (quem ficou em 1º a 3º com a colocação, o resto com o link).
 * Só depois do prazo e uma vez só.
 */
export async function publishResult(
  c: OpenChallenge,
  actor: Pick<Member, "id" | "username">,
  picks: PlacePick[],
): Promise<{ notified: number }> {
  if (c.status === "resultado") throw new OpenChallengeError("O resultado já saiu.", 409);
  if (c.phase !== "encerrado") throw new OpenChallengeError("O resultado sai depois do prazo de entrega.", 400);
  return db.transaction(async () => {
    const locked = await db
      .prepare(
        `UPDATE open_challenges SET status = 'resultado', resultAt = sqlite_now()
         WHERE id = ? AND status = 'aberto' AND to_ts(deadline) <= now()
         RETURNING id`,
      )
      .get<{ id: number }>(c.id);
    if (!locked) throw new OpenChallengeError("O resultado já saiu.", 409);
    const entries = await db
      .prepare("SELECT id, memberId FROM open_challenge_entries WHERE challengeId = ?")
      .all<{ id: number; memberId: number }>(c.id);
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const p of picks) {
      if (!byId.has(p.entryId)) throw new OpenChallengeError("Essa entrega não é deste desafio.", 400);
    }
    for (const p of picks) {
      await db.prepare("UPDATE open_challenge_entries SET place = ? WHERE id = ?").run(p.place, p.entryId);
    }
    const placeOf = new Map(picks.map((p) => [byId.get(p.entryId)!.memberId, p.place]));
    for (const e of entries) {
      const place = placeOf.get(e.memberId);
      await notify(e.memberId, {
        type: "desafio_resultado",
        actorId: actor.id,
        actorUsername: actor.username,
        text: place
          ? `Saiu o resultado de "${c.title}": sua entrega ficou em ${PLACE_LABELS[place]}.`
          : `Saiu o resultado de "${c.title}". Veja quem levou.`,
        href: `/desafios/${c.id}`,
      });
    }
    return { notified: entries.length };
  })();
}

/** "faltam 3 dias", "faltam 5 h", "acabou" — legível sem relógio na cabeça */
export function timeLeft(deadline: string, now: Date = new Date()): string {
  const d = parseEventTime(deadline);
  if (!d) return "";
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return "prazo encerrado";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "falta menos de 1 hora";
  if (h < 48) return `faltam ${h} h`;
  return `faltam ${Math.floor(h / 24)} dias`;
}

const deadlineFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "14 de nov., 23:59" no horário de Brasília */
export function formatDeadline(deadline: string): string {
  const d = parseEventTime(deadline);
  return d ? deadlineFmt.format(d).replace(".", "") : deadline;
}

// ---------- guarda das rotas ----------

const json = (error: string, status: number) => Response.json({ error }, { status });

/**
 * 401 deslogado; 404 pra id ruim, desafio que não existe ou que a pessoa
 * não pode ver (rascunho de outra comunidade, comunidade escondida).
 */
export async function requireOpenChallenge(
  rawId: string,
): Promise<{ member: Member; challenge: OpenChallenge } | { response: Response }> {
  const member = await currentMember();
  if (!member) return { response: json("Unauthorized", 401) };
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : NaN;
  const challenge = await getOpenChallenge(id);
  if (!challenge || !(await canSeeChallenge(member, challenge))) return { response: json("Desafio não encontrado", 404) };
  return { member, challenge };
}

/** OpenChallengeError → resposta; outro erro sobe */
export function challengeErrorResponse(e: unknown): Response {
  if (e instanceof OpenChallengeError) return json(e.message, e.status);
  throw e;
}
