import db from "@/lib/db";
import { isBlockedEither } from "@/lib/blocks";
import { notify } from "@/lib/notifications";
import { hydratePosts, listPostIds, createPost, type Post } from "@/lib/posts";

// Diário do projeto e seguir projeto (spec 046, onda 3, migration 044).
//
// O projeto continua depois do evento: o time posta atualização na página
// dele (/p/[teamId]), quem quiser segue o projeto e recebe no máximo UM aviso
// por dia, mesmo com várias atualizações. A atualização é post (posts.teamId):
// edição, reação, resposta, menção, denúncia e moderação vêm de graça.
//
// Regras:
// - só integrante do time posta no diário (team_members.username);
// - texto até 1000 (o diário é mais longo que o post do feed, que é 500);
// - seguir projeto é leve: não é entrar no time, não vê nada de privado e não
//   dá XP, badge nem item do bicho (plano 046, naoFazer);
// - a contagem de quem segue é só do time: visitante nunca vê o número
//   (mesma regra do seguir pessoa, 044 §"contadores públicos").

export const PROJECT_UPDATE_MAX = 1000;
/** "1 aviso por projeto por dia" — a janela do dedupe */
export const PROJECT_UPDATE_NOTIFY_DAYS = 1;
export const PROJECT_DIARY_PAGE_SIZE = 10;

export class ProjectUpdateFailure extends Error {
  status: 400 | 403 | 404;
  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.status = status;
  }
}

/** o time existe? (404 na rota quando não) */
export async function teamExists(teamId: number): Promise<boolean> {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return false;
  return !!(await db.prepare("SELECT 1 AS ok FROM teams WHERE id = ?").get(teamId));
}

/** quem é do time: username em team_members (a mesma fonte de lib/entries) */
export async function isTeamMember(teamId: number, username: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM team_members WHERE teamId = ? AND username = ?").get(teamId, username));
}

/**
 * Uma página do diário, mais novo primeiro. `antes` é o cursor (id
 * exclusivo), igual à timeline. Quem o leitor bloqueou/silenciou fica fora.
 */
export async function projectDiary(
  teamId: number,
  meId: number | null,
  antes: number | null = null,
  limit = PROJECT_DIARY_PAGE_SIZE,
): Promise<{ posts: Post[]; next: number | null }> {
  const size = Math.min(Math.max(Math.floor(limit) || PROJECT_DIARY_PAGE_SIZE, 1), 50);
  // uma a mais só pra saber se tem próxima
  const ids = await listPostIds({ kind: "team", id: teamId }, meId, { antes, limit: size + 1 });
  const page = ids.slice(0, size);
  return { posts: await hydratePosts(page, meId), next: ids.length > size && page.length > 0 ? page[page.length - 1] : null };
}

/**
 * Posta uma atualização no diário do projeto e avisa quem segue o projeto
 * (no máximo um aviso por pessoa por projeto por dia). Erros de permissão e
 * de validação saem como ProjectUpdateFailure, com o status da rota.
 */
export async function createProjectUpdate(
  teamId: number,
  member: { id: number; username: string },
  body: unknown,
  link: unknown = null,
): Promise<Post> {
  if (!(await teamExists(teamId))) throw new ProjectUpdateFailure("Projeto não encontrado.", 404);
  if (!(await isTeamMember(teamId, member.username))) {
    throw new ProjectUpdateFailure("Só quem está no time posta no diário do projeto.", 403);
  }
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new ProjectUpdateFailure("Escreva a atualização.", 400);
  if (text.length > PROJECT_UPDATE_MAX) {
    throw new ProjectUpdateFailure(`Atualização longa demais (máx. ${PROJECT_UPDATE_MAX}).`, 400);
  }
  const url = typeof link === "string" ? link.trim() || null : null;
  let post: Post;
  try {
    post = await createPost(member.id, text, url, null, null, null, teamId);
  } catch (e) {
    throw new ProjectUpdateFailure(e instanceof Error ? e.message : "Atualização inválida.", 400);
  }
  await notifyProjectFollowers(teamId, member);
  return post;
}

/**
 * Avisa quem segue o projeto. Dedupe por (pessoa, projeto, dia): a chave é o
 * href da página do projeto, não o ator — três integrantes postando no mesmo
 * dia continuam sendo um aviso só. A trava por projeto+pessoa evita que dois
 * posts simultâneos notifiquem duas vezes.
 */
async function notifyProjectFollowers(teamId: number, member: { id: number; username: string }): Promise<number> {
  const href = `/p/${teamId}`;
  const title = await db
    .prepare("SELECT tp.title FROM team_projects tp WHERE tp.teamId = ?")
    .get<{ title: string }>(teamId);
  const followers = await db
    .prepare(
      `SELECT pf.memberId FROM project_follows pf JOIN members m ON m.id = pf.memberId
       WHERE pf.teamId = ? AND m.clerkId NOT LIKE 'deleted:%'`,
    )
    .all<{ memberId: number }>(teamId);
  let sent = 0;
  for (const f of followers) {
    const id = Number(f.memberId);
    if (id === member.id) continue;
    if (await isBlockedEither(id, member.id)) continue;
    const ok = await db.transaction(async () => {
      await db
        .prepare("SELECT pg_advisory_xact_lock(hashtext(?::text)) AS ok")
        .get(`project-update:${teamId}:${id}`);
      if (await notifiedToday(id, href)) return false;
      await notify(id, {
        type: "project_update",
        actorId: member.id,
        actorUsername: member.username,
        text: `${title?.title ?? "O projeto"} tem atualização nova`,
        href,
      });
      return true;
    })();
    if (ok) sent++;
  }
  return sent;
}

/** já avisei essa pessoa sobre esse projeto na janela do dedupe? */
async function notifiedToday(memberId: number, href: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS y FROM notifications
       WHERE memberId = ? AND type = 'project_update' AND href IS NOT DISTINCT FROM ?::text
         AND to_ts(createdAt) >= now() - make_interval(days => ?::int)
       LIMIT 1`,
    )
    .get<{ y: number }>(memberId, href, PROJECT_UPDATE_NOTIFY_DAYS);
  return !!row;
}

// ---------- seguir projeto ----------

/** segue (idempotente); false = já seguia */
export async function followProject(memberId: number, teamId: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO project_follows (memberId, teamId) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .run(memberId, teamId);
  return r.changes > 0;
}

/** deixa de seguir (idempotente); false = não seguia */
export async function unfollowProject(memberId: number, teamId: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM project_follows WHERE memberId = ? AND teamId = ?").run(memberId, teamId);
  return r.changes > 0;
}

export async function isFollowingProject(memberId: number, teamId: number): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM project_follows WHERE memberId = ? AND teamId = ?").get(memberId, teamId));
}

/** segue algum projeto? (a aba padrão do /feed é "seguindo") */
export async function followsAnyProject(memberId: number): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM project_follows WHERE memberId = ? LIMIT 1").get(memberId));
}

/**
 * Quantos seguem o projeto. Só o time e a organização da edição veem o
 * número; pra qualquer outra pessoa a página não mostra contador.
 */
export async function projectFollowerCount(teamId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM project_follows pf JOIN members m ON m.id = pf.memberId
       WHERE pf.teamId = ? AND m.clerkId NOT LIKE 'deleted:%'`,
    )
    .get<{ n: number }>(teamId);
  return Number(row?.n ?? 0);
}

/** ids de quem segue — o aviso de atualização parte daqui */
export async function projectFollowerIds(teamId: number): Promise<number[]> {
  return (
    await db.prepare("SELECT memberId FROM project_follows WHERE teamId = ? ORDER BY memberId").all<{ memberId: number }>(teamId)
  ).map((r) => Number(r.memberId));
}
