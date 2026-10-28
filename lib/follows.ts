import db from "@/lib/db";
import { getMembership } from "@/lib/communities";

// Seguir comunidade (migration 030). Decisão de produto: membro = segue.
// O "seguir" leve existe pra quem não quer ser membro (comunidade de outra
// cidade, de outra faculdade): vê mural, avisos e hackathons dela no /feed e
// no painel e recebe o anúncio de hackathon publicado. Não posta no mural,
// não recebe notificação de aviso e não entra na contagem de membros.

/** as comunidades que a pessoa segue: as dela (membro) mais as seguidas */
const FOLLOWED_SQL = `SELECT cm.communityId FROM community_members cm WHERE cm.memberId = @me
  UNION SELECT cf.communityId FROM community_follows cf WHERE cf.memberId = @me`;

export type FollowResult = "followed" | "already" | "member";

/**
 * segue. Quem já é membro não ganha linha nova (membro já segue). A checagem
 * de membro vai no próprio INSERT; a corrida com o entrar que ainda sobrar
 * o leaveCommunity limpa.
 */
export async function followCommunity(communityId: number, memberId: number): Promise<FollowResult> {
  const res = await db
    .prepare(
      `INSERT INTO community_follows (communityId, memberId)
       SELECT @c, @m WHERE NOT EXISTS (SELECT 1 FROM community_members WHERE communityId = @c AND memberId = @m)
       ON CONFLICT DO NOTHING`,
    )
    .run({ c: communityId, m: memberId });
  if (res.changes > 0) return "followed";
  return (await getMembership(communityId, memberId)) ? "member" : "already";
}

export async function unfollowCommunity(communityId: number, memberId: number): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM community_follows WHERE communityId = ? AND memberId = ?")
    .run(communityId, memberId);
  return res.changes > 0;
}

export async function isFollowing(communityId: number, memberId: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM community_follows WHERE communityId = ? AND memberId = ?")
    .get(communityId, memberId);
  return !!row;
}

/** ids das comunidades em que a pessoa é membro e das que ela só segue (/comunidades) */
export async function followStates(memberId: number): Promise<{ member: Set<number>; following: Set<number> }> {
  const [m, f] = await Promise.all([
    db.prepare("SELECT communityId FROM community_members WHERE memberId = ?").all<{ communityId: number }>(memberId),
    db.prepare("SELECT communityId FROM community_follows WHERE memberId = ?").all<{ communityId: number }>(memberId),
  ]);
  return { member: new Set(m.map((r) => r.communityId)), following: new Set(f.map((r) => r.communityId)) };
}

/** segue (ou é membro de) alguma comunidade visível? decide a aba padrão do /feed */
export async function followsAnyCommunity(memberId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM (${FOLLOWED_SQL}) s JOIN communities c ON c.id = s.communityId WHERE c.hidden = 0) AS ok`,
    )
    .get<{ ok: boolean }>({ me: memberId });
  return Boolean(row?.ok);
}

/** quem recebe o anúncio de hackathon publicado: membros e quem segue, sem conta excluída */
export async function communityAudience(communityId: number): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT m.id FROM members m
       WHERE m.clerkId NOT LIKE 'deleted:%' AND (
         m.id IN (SELECT memberId FROM community_members WHERE communityId = @c)
         OR m.id IN (SELECT memberId FROM community_follows WHERE communityId = @c))
       ORDER BY m.id`,
    )
    .all<{ id: number }>({ c: communityId });
  return rows.map((r) => r.id);
}

// ---------- feed "minhas comunidades" ----------

export type CommunityUpdateKind = "post" | "aviso" | "hackathon";

export type CommunityUpdate = {
  kind: CommunityUpdateKind;
  /** id do post/aviso (texto) ou da edição */
  id: string;
  at: string;
  /** título do aviso ou nome do hackathon; post não tem */
  title: string | null;
  body: string | null;
  link: string | null;
  startsAt: string | null;
  location: string | null;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  communityId: number;
  communitySlug: string;
  communityName: string;
};

export const FEED_PAGE_SIZE = 20;

/**
 * Mural, avisos e hackathons publicados das comunidades que a pessoa segue
 * ou de que é membro, do mais novo pro mais velho. Comunidade escondida pela
 * moderação some. Paginação por página (offset), como o resto das listas.
 */
export async function listCommunityUpdates(
  memberId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<CommunityUpdate[]> {
  const limit = Math.min(Math.max(opts.limit ?? FEED_PAGE_SIZE, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  return db
    .prepare(
      `WITH seg AS (${FOLLOWED_SQL})
       SELECT x.kind, x.id, x.at, x.title, x.body, x.link, x.startsAt, x.location,
              x.username, x.name, x.avatarUrl,
              c.id AS "communityId", c.slug AS "communitySlug", c.name AS "communityName"
       FROM (
         SELECT 'post' AS kind, p.id::text AS id, p.createdAt AS at, NULL::text AS title, p.body, p.link,
                NULL::text AS startsAt, NULL::text AS location, m.username, m.name, m.avatarUrl, p.communityId AS cid
         FROM posts p JOIN members m ON m.id = p.memberId
         WHERE p.communityId IN (SELECT communityId FROM seg)
         UNION ALL
         SELECT 'aviso', n.id::text, n.createdAt, n.title, n.body, NULL,
                NULL, NULL, m.username, m.name, m.avatarUrl, n.communityId
         FROM community_notices n LEFT JOIN members m ON m.id = n.createdBy
         WHERE n.communityId IN (SELECT communityId FROM seg)
         UNION ALL
         SELECT 'hackathon', h.id, h.publishedAt, h.name, h.description, NULL,
                h.startsAt, h.location, NULL, NULL, NULL, h.communityId
         FROM hackathons h
         WHERE h.communityId IN (SELECT communityId FROM seg) AND h.active = 1 AND h.publishedAt IS NOT NULL
       ) x JOIN communities c ON c.id = x.cid AND c.hidden = 0
       ORDER BY to_ts(x.at) DESC, x.kind, x.id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all<CommunityUpdate>({ me: memberId, limit, offset });
}

/** página N (1-based) + se tem mais: busca uma linha a mais pra saber */
export async function communityUpdatesPage(
  memberId: number,
  page: number,
): Promise<{ items: CommunityUpdate[]; page: number; hasMore: boolean }> {
  const p = Number.isFinite(page) && page >= 1 ? Math.min(Math.floor(page), 500) : 1;
  const rows = await listCommunityUpdates(memberId, { limit: FEED_PAGE_SIZE + 1, offset: (p - 1) * FEED_PAGE_SIZE });
  return { items: rows.slice(0, FEED_PAGE_SIZE), page: p, hasMore: rows.length > FEED_PAGE_SIZE };
}

/** onde o item abre: post e aviso na página da comunidade, hackathon na dele */
export function updateHref(u: Pick<CommunityUpdate, "kind" | "id" | "communitySlug">): string {
  if (u.kind === "hackathon") return `/h/${u.id}`;
  return `/comunidade/${u.communitySlug}#${u.kind === "aviso" ? "avisos" : "mural"}`;
}
