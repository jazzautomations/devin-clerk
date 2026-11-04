import db from "@/lib/db";
import { hiddenAuthorSql } from "@/lib/blocks";
import { parseEventTime } from "@/lib/eventTime";
import { followsAnyCommunity } from "@/lib/follows";
import { hostedSql } from "@/lib/hackathons";
import { followingIds } from "@/lib/memberFollows";
import { hydratePosts, type Post } from "@/lib/posts";

// Timeline (spec 046, onda 2, migration 038). O /feed vira a página social:
// quatro abas cronológicas, cursor por id (nunca OFFSET) e um lugar pra abrir
// todo dia. Sem algoritmo: ORDER BY p.id DESC, ponto.
//
// CONTRATO pras próximas ondas (menções, perfil, projeto vivo, repost, busca):
//
// - timelinePage(meId, aba, antes?, limit) devolve {posts, next}. `posts` são
//   Post hidratado (hydratePosts de lib/posts.ts), na ordem dos ids; `next` é
//   o cursor da página seguinte (null quando acabou) e vai em ?antes=.
// - Toda aba exclui autor bloqueado (dois sentidos) ou silenciado
//   (hiddenAuthorSql = a forma SQL de hiddenIdsFor) e post de espaço fora do
//   ar: comunidade escondida, edição inativa ou de comunidade escondida.
// - "seguindo": quem eu sigo (followingIds), as comunidades em que sou membro
//   ou que sigo, as edições com inscrição aprovada minha e os meus posts.
//   "comunidades": o mural das minhas comunidades (a página usa
//   communityUpdatesPage, que traz também aviso, hackathon e agenda).
//   "ao-vivo": mural das edições que rodam no HackaHub agora (listLiveEditions).
//   "tudo": todo post visível.
// - countNewPosts é o "N posts novos" do TimelineList: mesma query, id > desde.
// - Nada aqui dá XP, badge ou ordenação por reação (plano 046, naoFazer).

export const TIMELINE_TABS = ["seguindo", "comunidades", "ao-vivo", "tudo"] as const;
export type TimelineTab = (typeof TIMELINE_TABS)[number];

export const TIMELINE_TAB_LABEL: Record<TimelineTab, string> = {
  seguindo: "seguindo",
  comunidades: "comunidades",
  "ao-vivo": "ao vivo",
  tudo: "tudo",
};

export const TIMELINE_PAGE_SIZE = 20;
/** o painel mostra os 5 primeiros da aba seguindo */
export const TIMELINE_HOME_SIZE = 5;

export function isTimelineTab(v: unknown): v is TimelineTab {
  return typeof v === "string" && (TIMELINE_TABS as readonly string[]).includes(v);
}

/** link de aba e de "carregar mais": ?aba= sempre explícito */
export function timelineHref(aba: TimelineTab, antes?: number | null): string {
  return antes ? `/feed?aba=${aba}&antes=${antes}` : `/feed?aba=${aba}`;
}

/** ?antes= e ?desde= da timeline: inteiro positivo ou null */
export function parseCursor(raw: unknown): number | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(typeof first === "string" ? first : first);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export type TimelinePage = { posts: Post[]; next: number | null };

// o mesmo "espaço no ar" de lib/posts.ts (SPACE_UP_SQL, lá é privado): post de
// mural de edição tem communityId NULL, a comunidade dele é a da edição.
const SPACE_UP_SQL = `NOT EXISTS (SELECT 1 FROM communities co WHERE co.id = p.communityId AND co.hidden = 1)
  AND NOT EXISTS (SELECT 1 FROM hackathons hh LEFT JOIN communities hc ON hc.id = hh.communityId
    WHERE hh.id = p.hackathonId AND (hh.active = 0 OR hc.hidden = 1))`;

// as comunidades que a pessoa acompanha: as dela (membro) mais as seguidas
const MY_COMMUNITIES_SQL = `SELECT cm.communityId FROM community_members cm WHERE cm.memberId = @me
  UNION SELECT cf.communityId FROM community_follows cf WHERE cf.memberId = @me`;

const DAY_MS = 86_400_000;

export type LiveEdition = { id: string; name: string; startsAt: string; endsAt: string | null };

/** a edição está rolando? do início até o fim; sem fim, um dia de evento */
export function isLive(e: { startsAt: string; endsAt: string | null }, now = new Date()): boolean {
  const start = parseEventTime(e.startsAt);
  if (!start) return false;
  const end = parseEventTime(e.endsAt) ?? new Date(start.getTime() + DAY_MS);
  const t = now.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** edições que rodam no HackaHub agora (hosted, ativas, de comunidade no ar) */
export async function listLiveEditions(now = new Date()): Promise<LiveEdition[]> {
  const rows = await db
    .prepare(
      `SELECT h.id, h.name, h.startsAt, h.endsAt FROM hackathons h
       LEFT JOIN communities c ON c.id = h.communityId
       WHERE h.active = 1 AND ${hostedSql("h")} AND COALESCE(c.hidden, 0) = 0
         AND to_ts(h.startsAt) <= @now::timestamptz
       ORDER BY to_ts(h.startsAt) DESC`,
    )
    .all<LiveEdition>({ now: now.toISOString() });
  return rows.filter((r) => isLive(r, now));
}

type Scope = { where: string[]; params: Record<string, unknown> };

/** o recorte de cada aba, com o filtro de segurança em todas */
async function scopeFor(meId: number | null, aba: TimelineTab, now: Date): Promise<Scope> {
  const params: Record<string, unknown> = { me: meId ?? -1 };
  const where: string[] = [SPACE_UP_SQL, hiddenAuthorSql("p.memberId")];
  switch (aba) {
    case "seguindo": {
      if (!meId) {
        // deslogado não segue ninguém: a aba é vazia, não um erro
        where.push("FALSE");
        break;
      }
      const following = await followingIds(meId);
      params.following = following.length > 0 ? following : [-1];
      where.push(`(p.memberId = @me
        OR p.memberId = ANY(@following::int[])
        OR p.communityId IN (${MY_COMMUNITIES_SQL})
        OR p.hackathonId IN (SELECT r.hackathonId FROM registrations r WHERE r.memberId = @me AND r.status = 'approved'))`);
      break;
    }
    case "comunidades":
      where.push(`p.communityId IN (${MY_COMMUNITIES_SQL})`);
      break;
    case "ao-vivo": {
      const live = await listLiveEditions(now);
      params.editions = live.length > 0 ? live.map((e) => e.id) : ["-"];
      where.push("p.hackathonId = ANY(@editions::text[])");
      break;
    }
    case "tudo":
      break;
  }
  return { where, params };
}

/**
 * Uma página da timeline. `antes` é o cursor (id exclusivo): p.id < antes,
 * ORDER BY p.id DESC, sem OFFSET. `next` null = acabou.
 */
export async function timelinePage(
  meId: number | null,
  aba: TimelineTab,
  antes?: number | null,
  limit = TIMELINE_PAGE_SIZE,
  now = new Date(),
): Promise<TimelinePage> {
  const size = Math.min(Math.max(Math.floor(limit) || TIMELINE_PAGE_SIZE, 1), 50);
  const { where, params } = await scopeFor(meId, aba, now);
  if (antes) {
    where.push("p.id < @antes");
    params.antes = antes;
  }
  params.limit = size + 1; // uma a mais só pra saber se tem próxima
  const rows = await db
    .prepare(`SELECT p.id FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT @limit`)
    .all<{ id: number }>(params);
  const ids = rows.slice(0, size).map((r) => Number(r.id));
  const posts = await hydratePosts(ids, meId);
  const next = rows.length > size && ids.length > 0 ? ids[ids.length - 1] : null;
  return { posts, next };
}

/** quantos posts entraram na aba depois de `desde` (o "N posts novos" do /feed) */
export async function countNewPosts(
  meId: number | null,
  aba: TimelineTab,
  desde: number,
  now = new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(desde) || desde <= 0) return 0;
  const { where, params } = await scopeFor(meId, aba, now);
  where.push("p.id > @desde");
  params.desde = desde;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where.join(" AND ")}`)
    .get<{ n: number }>(params);
  return Number(row?.n ?? 0);
}

/**
 * Aba padrão do /feed: "seguindo" pra quem segue alguém ou alguma comunidade;
 * senão "tudo" (quem chega não cai numa tela vazia).
 */
export async function timelineDefaultTab(meId: number | null): Promise<TimelineTab> {
  if (!meId) return "tudo";
  const [following, communities] = await Promise.all([followingIds(meId), followsAnyCommunity(meId)]);
  return following.length > 0 || communities ? "seguindo" : "tudo";
}
