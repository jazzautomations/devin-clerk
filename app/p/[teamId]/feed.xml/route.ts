import { getProjectView } from "@/lib/entriesPublic";
import { atomFeed, feedNotFound, feedResponse, postEntry } from "@/lib/feeds";
import { parseId } from "@/lib/ids";
import { hydratePosts, listPostIds } from "@/lib/posts";
import { absoluteUrl } from "@/lib/seo";

// /p/[teamId]/feed.xml — Atom do diário do projeto (rss-aberto). Só vale
// quando o projeto está no arquivo aberto pra quem não tem conta
// (openToPublic, a mesma trava do cartão público da página); antes disso,
// edição fora do ar ou time abandonado: 404.

export async function GET(_req: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const id = parseId(teamId);
  const data = id === null ? null : await getProjectView(id, null);
  if (!data || !data.openToPublic) return feedNotFound();
  const posts = await hydratePosts(await listPostIds({ kind: "team", id: data.teamId }, null, { limit: 30 }), null);
  return feedResponse(
    atomFeed({
      title: `${data.title} — diário do projeto`,
      pageUrl: absoluteUrl(`/p/${data.teamId}`),
      selfUrl: absoluteUrl(`/p/${data.teamId}/feed.xml`),
      entries: posts.map(postEntry),
    }),
  );
}
