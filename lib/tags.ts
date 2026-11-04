import db from "@/lib/db";
import { hiddenAuthorSql } from "@/lib/blocks";
import { getOpenHackathons, type Hackathon } from "@/lib/hackathons";
import { alreadyNotified, notify } from "@/lib/notifications";
import { hydratePosts, spaceUpSql, type Post } from "@/lib/posts";
import { extractMentions, extractTags } from "@/lib/richText";
import { normalizeTech, TAG_RE, TECH_ALIASES } from "@/lib/techTags";

// Menções @ e tags # (spec 046, onda 2, migration 039).
//
// O texto do post/comentário é a fonte; post_mentions e post_tags são índices
// derivados, reescritos a cada create/update por syncMentionsAndTags. Regras:
//
// - menção só é gravada quando o @ é de membro que existe, não foi excluído
//   (clerkId "deleted:…") e não tem bloqueio com quem escreveu (dois
//   sentidos). Menção não gravada não vira link nem notificação;
// - até 5 menções e 5 tags por texto (lib/richText.ts);
// - post_tags só no post: tag de comentário não tem página;
// - quem já estava mencionado antes da edição não é notificado de novo —
//   nem quando o @ sai e volta num edit seguinte;
// - a notificação é do tipo "mention" (grupo social, lib/notifications.ts) e
//   leva pro post, ou pro comentário quando a menção está num comentário.

export type TagActor = { id: number; username: string };

/** @ que dá pra gravar: existe, não foi excluído e não tem bloqueio com o autor */
async function resolvableMentions(names: string[], authorId: number): Promise<{ id: number; username: string }[]> {
  if (names.length === 0) return [];
  return db
    .prepare(
      `SELECT m.id, m.username FROM members m
       WHERE m.username = ANY(@names::text[])
         AND m.clerkId NOT LIKE 'deleted:%'
         AND NOT EXISTS (SELECT 1 FROM member_blocks b
           WHERE (b.memberId = @author AND b.blockedId = m.id)
              OR (b.memberId = m.id AND b.blockedId = @author))`,
    )
    .all<{ id: number; username: string }>({ names, author: authorId });
}

/** ids já mencionados neste post (commentId nulo) ou neste comentário */
async function storedMentions(postId: number, commentId: number | null): Promise<number[]> {
  const rows = await db
    .prepare(
      commentId === null
        ? `SELECT "memberId" AS id FROM post_mentions WHERE "postId" = ? AND "commentId" IS NULL`
        : `SELECT "memberId" AS id FROM post_mentions WHERE "commentId" = ?`,
    )
    .all<{ id: number }>(commentId === null ? postId : commentId);
  return rows.map((r) => Number(r.id));
}

/**
 * Reescreve o índice de menções e tags do texto e notifica quem é mencionado
 * pela primeira vez. Chamado por createPost/updatePost (commentId null),
 * createComment e updateComment. Devolve o que ficou gravado.
 */
export async function syncMentionsAndTags(
  postId: number,
  commentId: number | null,
  body: string,
  actor: TagActor,
): Promise<{ mentions: number[]; tags: string[] }> {
  const people = await resolvableMentions(extractMentions(body), actor.id);
  const ids = people.map((p) => Number(p.id));
  const known = new Set(await storedMentions(postId, commentId));

  await db
    .prepare(
      commentId === null
        ? `DELETE FROM post_mentions WHERE "postId" = ? AND "commentId" IS NULL`
        : `DELETE FROM post_mentions WHERE "commentId" = ?`,
    )
    .run(commentId === null ? postId : commentId);
  await Promise.all(
    ids.map((memberId) =>
      db
        .prepare(`INSERT OR IGNORE INTO post_mentions ("postId", "commentId", "memberId") VALUES (?, ?, ?)`)
        .run(postId, commentId, memberId),
    ),
  );

  let tags: string[] = [];
  if (commentId === null) {
    tags = extractTags(body).filter((t) => TAG_RE.test(t));
    await db.prepare(`DELETE FROM post_tags WHERE "postId" = ?`).run(postId);
    await Promise.all(
      tags.map((tag) => db.prepare(`INSERT OR IGNORE INTO post_tags ("postId", "tag") VALUES (?, ?)`).run(postId, tag)),
    );
  }

  const href = commentId === null ? `/post/${postId}` : `/post/${postId}#c-${commentId}`;
  for (const person of people) {
    if (Number(person.id) === actor.id || known.has(Number(person.id))) continue;
    // editar pode tirar e pôr o @ de volta: a notificação é uma só por destino
    if (await alreadyNotified(Number(person.id), "mention", actor.id, href, null)) continue;
    await notify(Number(person.id), {
      type: "mention",
      actorId: actor.id,
      actorUsername: actor.username,
      text: `@${actor.username} mencionou você`,
      href,
    });
  }

  return { mentions: ids, tags };
}

/**
 * Posts de uma tag, do mais novo pro mais antigo, com cursor `antes` (id
 * exclusivo). Mesma visibilidade do feed: espaço fora do ar fica de fora e
 * autor bloqueado/silenciado não aparece. Quem monta o card é hydratePosts.
 */
export async function postIdsByTag(
  tag: string,
  meId: number | null,
  antes: number | null = null,
  limit = 20,
): Promise<Post[]> {
  const clean = normalizeTech(tag);
  if (!clean) return [];
  const rows = await db
    .prepare(
      `SELECT p.id FROM posts p JOIN post_tags pt ON pt."postId" = p.id
       WHERE pt.tag = @tag AND ${spaceUpSql()}
         AND ${hiddenAuthorSql("p.memberId")}
         AND (@antes::int IS NULL OR p.id < @antes::int)
       ORDER BY p.id DESC LIMIT @limit::int`,
    )
    .all<{ id: number }>({ tag: clean, me: meId ?? -1, antes, limit: Math.max(1, Math.min(limit, 50)) });
  return hydratePosts(
    rows.map((r) => Number(r.id)),
    meId,
  );
}

/** a mesma normalização de normalizeTech (lib/techTags.ts), em SQL: skills é texto livre em JSON */
export function sqlTechTag(expr: string): string {
  const base = `regexp_replace(regexp_replace(regexp_replace(translate(lower(trim(${expr})), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '\\s+', '-', 'g'), '[^a-z0-9.+#-]', '', 'g'), '^[^a-z0-9]+', '')`;
  const aliases = Object.entries(TECH_ALIASES)
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
    .join(" ");
  return `(CASE ${base} ${aliases} ELSE ${base} END)`;
}

export type TagPerson = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
};

/**
 * Pessoas com a tag nas skills (members.skills é JSON de texto livre: a
 * comparação normaliza no SQL, "Next.js" casa com #nextjs). Sem contagem de
 * seguidores — só quem é, pra seguir.
 */
export async function peopleBySkill(tag: string, meId: number | null, limit = 12): Promise<TagPerson[]> {
  const clean = normalizeTech(tag);
  if (!clean) return [];
  return db
    .prepare(
      `SELECT m.id, m.username, m.name, m.avatarUrl, m.headline, m.persona, m.xp
       FROM members m
       WHERE m.clerkId NOT LIKE 'deleted:%'
         AND ${hiddenAuthorSql("m.id")}
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN trim(m.skills) = '' THEN '[]'::jsonb ELSE m.skills::jsonb END) sk
           WHERE ${sqlTechTag("sk")} = @tag)
       ORDER BY m.xp DESC, m.username ASC LIMIT @limit::int`,
    )
    .all<TagPerson>({ tag: clean, me: meId ?? -1, limit });
}

/** hackathons abertos com a tag (tags é JSON; "IA" e "ia" são a mesma) */
export async function hackathonsByTag(tag: string, now = new Date()): Promise<Hackathon[]> {
  const clean = normalizeTech(tag);
  if (!clean) return [];
  const open = await getOpenHackathons(now);
  return open.filter((h) => (h.tags ?? []).some((t) => normalizeTech(t) === clean));
}

/** forma canônica da tag na URL; null quando não sobra tag válida */
export function normalizeTagParam(raw: string | null | undefined): string | null {
  const tag = normalizeTech(raw ?? "");
  return tag && tag.length >= 2 ? tag : null;
}
