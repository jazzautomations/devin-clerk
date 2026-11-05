import { getCommunityBySlug } from "@/lib/communities";
import { atomFeed, feedNotFound, feedResponse, postEntry } from "@/lib/feeds";
import { hydratePosts, listPostIds } from "@/lib/posts";
import { absoluteUrl } from "@/lib/seo";

// /comunidade/[slug]/feed.xml — Atom do mural da comunidade (rss-aberto):
// todos os espaços juntos. Comunidade escondida pela moderação ou excluída
// (deletedAt): 404.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCommunityBySlug(slug);
  if (!c || c.hidden) return feedNotFound();
  const posts = await hydratePosts(await listPostIds({ kind: "community", id: c.id }, null, { limit: 30 }), null);
  return feedResponse(
    atomFeed({
      title: `${c.name} — mural`,
      pageUrl: absoluteUrl(`/comunidade/${c.slug}`),
      selfUrl: absoluteUrl(`/comunidade/${c.slug}/feed.xml`),
      entries: posts.map(postEntry),
    }),
  );
}
