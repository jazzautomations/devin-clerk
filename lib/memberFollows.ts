import db from "@/lib/db";
import { alreadyNotified, notify } from "@/lib/notifications";

// Seguir pessoa (migration 033): memberId segue followedId. Sem placar.
//
// - Ninguém vê quantos seguem outra pessoa. ownCounts e as listas são só da
//   página do próprio dono (/u dele, /perfil/seguidores, /perfil/seguindo).
//   Quem visita vê só "segue você" (followsMe).
// - Bloqueio em qualquer sentido impede seguir, e bloquear apaga o seguir dos
//   dois lados (lib/blocks.ts). A checagem vai no próprio INSERT, então um
//   bloqueio que chega no meio não deixa linha pra trás.
// - Conta excluída some das listas; a exclusão LGPD já apaga as linhas
//   (followedId está em PEER_COLUMNS).
// - Seguir nunca dá XP, badge nem item do bicho (spec 043).

export type FollowOutcome = "ok" | "self" | "already" | "blocked";

export type FollowPerson = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  /** quem olha a lista (o dono) segue essa pessoa */
  followedByMe: boolean;
};

export type FollowPage = { people: FollowPerson[]; next: string | null };

export const FOLLOW_PAGE_SIZE = 30;

const BLOCKED_PAIR = (a: string, b: string) => `EXISTS (SELECT 1 FROM member_blocks fb
  WHERE (fb.memberId = ${a} AND fb.blockedId = ${b}) OR (fb.memberId = ${b} AND fb.blockedId = ${a}))`;

/** segue (idempotente). Notificação é com notifyNewFollower, quando dá 'ok'. */
export async function followMember(meId: number, targetId: number): Promise<FollowOutcome> {
  if (meId === targetId) return "self";
  const res = await db
    .prepare(
      `INSERT INTO member_follows (memberId, followedId)
       SELECT @me, @t WHERE NOT ${BLOCKED_PAIR("@me", "@t")}
       ON CONFLICT DO NOTHING`,
    )
    .run({ me: meId, t: targetId });
  if (res.changes > 0) return "ok";
  const row = await db
    .prepare(`SELECT ${BLOCKED_PAIR("@me", "@t")} AS blocked`)
    .get<{ blocked: boolean }>({ me: meId, t: targetId });
  return row?.blocked ? "blocked" : "already";
}

/** deixa de seguir (idempotente); true se havia linha */
export async function unfollowMember(meId: number, targetId: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM member_follows WHERE memberId = ? AND followedId = ?").run(meId, targetId);
  return res.changes > 0;
}

/** eu (meId) sigo targetId? */
export async function isFollowingMember(meId: number, targetId: number): Promise<boolean> {
  if (meId === targetId) return false;
  const row = await db
    .prepare("SELECT 1 AS ok FROM member_follows WHERE memberId = ? AND followedId = ?")
    .get(meId, targetId);
  return !!row;
}

/** targetId segue meId? É o selo "segue você" no /u de targetId */
export async function followsMe(meId: number, targetId: number): Promise<boolean> {
  return isFollowingMember(targetId, meId);
}

// quem entra nas listas e nos números: conta ativa e sem bloqueio com o dono
const VISIBLE = (col: string) => `m.id = ${col} AND m.clerkId NOT LIKE 'deleted:%' AND NOT ${BLOCKED_PAIR("@owner", "m.id")}`;

/** só pra página do próprio dono. Visitante nunca vê esses números. */
export async function ownCounts(memberId: number): Promise<{ seguidores: number; seguindo: number }> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM member_follows f JOIN members m ON ${VISIBLE("f.memberId")} WHERE f.followedId = @owner) AS seguidores,
         (SELECT COUNT(*) FROM member_follows f JOIN members m ON ${VISIBLE("f.followedId")} WHERE f.memberId = @owner) AS seguindo`,
    )
    .get<{ seguidores: number; seguindo: number }>({ owner: memberId });
  return { seguidores: Number(row?.seguidores ?? 0), seguindo: Number(row?.seguindo ?? 0) };
}

/** cursor da paginação: "AAAAMMDDHHMMSS-id" (data do seguir + id da pessoa) */
export function encodeFollowCursor(createdAt: string, id: number): string {
  return `${createdAt.replace(/\D/g, "")}-${id}`;
}

export function parseFollowCursor(raw: string | null | undefined): { at: string; id: number } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-(\d{1,10})$/.exec(raw ?? "");
  if (!m) return null;
  return { at: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`, id: Number(m[7]) };
}

async function listSide(
  side: "followers" | "following",
  memberId: number,
  before: string | null | undefined,
  limit: number,
): Promise<FollowPage> {
  const lim = Math.min(Math.max(Math.floor(limit) || FOLLOW_PAGE_SIZE, 1), 100);
  const cur = parseFollowCursor(before);
  // seguidores: as linhas que apontam pro dono; seguindo: as que saem dele
  const [mine, other] = side === "followers" ? ["followedId", "memberId"] : ["memberId", "followedId"];
  const rows = await db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline, f.createdAt AS "followedAt",
              EXISTS (SELECT 1 FROM member_follows mf WHERE mf.memberId = @owner AND mf.followedId = m.id) AS "followedByMe"
       FROM member_follows f JOIN members m ON ${VISIBLE(`f.${other}`)}
       WHERE f.${mine} = @owner
         AND (@at::text IS NULL OR f.createdAt < @at::text OR (f.createdAt = @at::text AND m.id < @cid::int))
       ORDER BY f.createdAt DESC, m.id DESC
       LIMIT @lim`,
    )
    .all<Omit<FollowPerson, "followedByMe"> & { followedAt: string; followedByMe: boolean }>({
      owner: memberId,
      at: cur?.at ?? null,
      cid: cur?.id ?? null,
      lim: lim + 1,
    });
  const page = rows.slice(0, lim);
  const last = page[page.length - 1];
  return {
    people: page.map((r) => ({
      id: Number(r.id),
      username: r.username,
      name: r.name,
      avatarUrl: r.avatarUrl,
      headline: r.headline,
      followedByMe: Boolean(r.followedByMe),
    })),
    next: rows.length > lim && last ? encodeFollowCursor(last.followedAt, Number(last.id)) : null,
  };
}

/** quem segue memberId, do seguir mais novo pro mais velho */
export function listFollowers(memberId: number, before?: string | null, limit = FOLLOW_PAGE_SIZE): Promise<FollowPage> {
  return listSide("followers", memberId, before, limit);
}

/** quem memberId segue, do seguir mais novo pro mais velho */
export function listFollowing(memberId: number, before?: string | null, limit = FOLLOW_PAGE_SIZE): Promise<FollowPage> {
  return listSide("following", memberId, before, limit);
}

/** ids de quem meId segue (conta ativa). A timeline filtra bloqueio/silêncio por conta própria. */
export async function followingIds(meId: number): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT f.followedId AS id FROM member_follows f JOIN members m ON m.id = f.followedId
       WHERE f.memberId = ? AND m.clerkId NOT LIKE 'deleted:%' ORDER BY f.followedId`,
    )
    .all<{ id: number }>(meId);
  return rows.map((r) => Number(r.id));
}

/**
 * Quem fez time com meId e ela ainda não segue (estado vazio de
 * /perfil/seguindo). Mais recente primeiro, sem conta excluída nem bloqueio.
 */
export async function teammatesToFollow(meId: number, limit = 6): Promise<FollowPerson[]> {
  const rows = await db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline, MAX(t.id) AS "lastTeam"
       FROM members me
       JOIN team_members tme ON tme.username = me.username
       JOIN teams t ON t.id = tme.teamId
       JOIN team_members tm ON tm.teamId = t.id AND tm.username <> me.username
       JOIN members m ON m.username = tm.username
       WHERE me.id = @owner AND m.clerkId NOT LIKE 'deleted:%'
         AND NOT ${BLOCKED_PAIR("@owner", "m.id")}
         AND NOT EXISTS (SELECT 1 FROM member_follows f WHERE f.memberId = @owner AND f.followedId = m.id)
       GROUP BY m.id, m.username, m.name, m.avatarUrl, m.headline
       ORDER BY MAX(t.id) DESC
       LIMIT @lim`,
    )
    .all<Omit<FollowPerson, "followedByMe">>({ owner: meId, lim: Math.min(Math.max(limit, 1), 30) });
  return rows.map((r) => ({
    id: Number(r.id),
    username: r.username,
    name: r.name,
    avatarUrl: r.avatarUrl,
    headline: r.headline,
    followedByMe: false,
  }));
}

/**
 * "@x começou a seguir você", uma vez por par a cada 7 dias. O dedupe é por
 * actorId e olha o href de cada @ que o ator já teve (username_redirects):
 * trocar de @ e seguir de novo não gera outra notificação.
 */
export async function notifyNewFollower(actor: { id: number; username: string }, targetId: number): Promise<boolean> {
  if (actor.id === targetId) return false;
  const old = await db
    .prepare("SELECT oldUsername FROM username_redirects WHERE memberId = ?")
    .all<{ oldUsername: string }>(actor.id);
  for (const u of [actor.username, ...old.map((r) => r.oldUsername)]) {
    if (await alreadyNotified(targetId, "follow", actor.id, `/u/${u}`, 7)) return false;
  }
  await notify(targetId, {
    type: "follow",
    actorId: actor.id,
    actorUsername: actor.username,
    text: `@${actor.username} começou a seguir você`,
    href: `/u/${actor.username}`,
  });
  return true;
}
