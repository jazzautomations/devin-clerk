import db from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";
import { spaceUpSql, type Post } from "@/lib/posts";

// RSS/Atom aberto (spec 046, onda 6 — "rss-aberto"): Atom 1.0 público, só
// do que já é público, sem custo de manutenção. Três feeds:
//
//   /u/[username]/feed.xml        posts globais da pessoa + diário dos
//                                 projetos dela — só com perfil aberto
//                                 (publicProfile=1 e canNetwork); senão 404
//   /p/[teamId]/feed.xml          diário do projeto — só quando o projeto
//                                 está no arquivo aberto; senão 404
//   /comunidade/[slug]/feed.xml   o mural inteiro (todos os espaços) — só
//                                 comunidade no ar; escondida/excluída: 404
//
// Os feeds ficam na allowlist pública (lib/access) e as páginas anunciam o
// endereço com <link rel="alternate" type="application/atom+xml"> nos
// layouts de cada segmento. Federação ActivityPub fica de fora (é spike).
// 30 itens, conteúdo em texto, link pro /post/[id], max-age 600.

export const FEED_LIMIT = 30;
export const FEED_CONTENT_TYPE = "application/atom+xml; charset=utf-8";
export const FEED_CACHE_CONTROL = "public, max-age=600";

/** escapa os cinco do XML e tira caractere de controle que invalida o doc */
export function escapeXml(v: string): string {
  return v
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, texto do banco) → ISO 8601 */
const iso = (dbTime: string) => `${dbTime.replace(" ", "T")}Z`;

export type FeedEntry = {
  /** id único e estável (a URL pública do post) */
  id: string;
  title: string;
  link: string;
  published: string;
  updated: string;
  content: string;
  author: string;
};

/** primeira linha, até 80: o título do item no leitor */
function entryTitle(body: string, username: string): string {
  const first = body.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!first) return `post de @${username}`;
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

/** post → item do feed: corpo em texto puro + link (se houver) em linha própria */
export function postEntry(p: Post): FeedEntry {
  const url = absoluteUrl(`/post/${p.id}`);
  return {
    id: url,
    title: entryTitle(p.body, p.username),
    link: url,
    published: iso(p.createdAt),
    updated: iso(p.editedAt ?? p.createdAt),
    content: p.link ? `${p.body}\n\n${p.link}` : p.body,
    author: `@${p.username}`,
  };
}

/** o documento Atom 1.0 inteiro, escapado em cada campo */
export function atomFeed(opts: {
  /** título do feed (ex.: "Hack Inova — mural") */
  title: string;
  /** URL da página que o feed representa */
  pageUrl: string;
  /** URL do próprio feed (rel=self e id) */
  selfUrl: string;
  entries: FeedEntry[];
}): string {
  const updated = opts.entries[0]?.updated ?? new Date().toISOString();
  const entries = opts.entries
    .map(
      (e) => `  <entry>
    <title>${escapeXml(e.title)}</title>
    <link href="${escapeXml(e.link)}" rel="alternate" type="text/html"/>
    <id>${escapeXml(e.id)}</id>
    <published>${escapeXml(e.published)}</published>
    <updated>${escapeXml(e.updated)}</updated>
    <author><name>${escapeXml(e.author)}</name></author>
    <content type="text">${escapeXml(e.content)}</content>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(opts.title)}</title>
  <link href="${escapeXml(opts.pageUrl)}" rel="alternate" type="text/html"/>
  <link href="${escapeXml(opts.selfUrl)}" rel="self" type="application/atom+xml"/>
  <id>${escapeXml(opts.selfUrl)}</id>
  <updated>${escapeXml(updated)}</updated>
${entries}
</feed>
`;
}

/** resposta do feed: Atom + cache curto de borda */
export function feedResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": FEED_CONTENT_TYPE, "Cache-Control": FEED_CACHE_CONTROL },
  });
}

/** 404 dos feeds: mesmo estilo das outras rotas */
export function feedNotFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Ids do feed do perfil: os posts GLOBAIS da pessoa (sem edição, sem
 * comunidade, sem recado) e as atualizações que ela escreveu no diário dos
 * projetos (posts.teamId). Repost não entra: o conteúdo seria o do
 * original, que pode ser de mural de edição ou comunidade — e feed aberto
 * só carrega o que a pessoa mesma escreveu em praça pública.
 */
export async function memberFeedPostIds(memberId: number, limit = FEED_LIMIT): Promise<number[]> {
  const size = Math.max(1, Math.min(Math.floor(limit) || FEED_LIMIT, 100));
  const rows = await db
    .prepare(
      `SELECT p.id FROM posts p
       WHERE p."memberId" = @m
         AND p."hackathonId" IS NULL AND p."communityId" IS NULL AND p."profileId" IS NULL
         AND p."repostOfId" IS NULL
         AND ${spaceUpSql("p")}
       ORDER BY p.id DESC LIMIT @limit`,
    )
    .all<{ id: number }>({ m: memberId, limit: size });
  return rows.map((r) => Number(r.id));
}
