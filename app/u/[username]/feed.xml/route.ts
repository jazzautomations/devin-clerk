import { atomFeed, feedNotFound, feedResponse, memberFeedPostIds, postEntry } from "@/lib/feeds";
import { getMemberByUsername } from "@/lib/members";
import { hydratePosts } from "@/lib/posts";
import { openProfile } from "@/lib/profileFacts";
import { absoluteUrl } from "@/lib/seo";

// /u/[username]/feed.xml — Atom do perfil ABERTO (rss-aberto): os posts
// globais da pessoa (nunca mural de edição, comunidade ou recado) e as
// atualizações que ela escreveu no diário dos projetos. Perfil fechado ou
// fora do canNetwork: 404 — o feed não vaza nem o nome.

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const member = await getMemberByUsername(username);
  if (!member || !(await openProfile(member.id, member.publicProfile ?? 0))) return feedNotFound();
  const posts = await hydratePosts(await memberFeedPostIds(member.id), null);
  return feedResponse(
    atomFeed({
      title: `${member.name ?? `@${member.username}`} no HackaHub`,
      pageUrl: absoluteUrl(`/u/${member.username}`),
      selfUrl: absoluteUrl(`/u/${member.username}/feed.xml`),
      entries: posts.map(postEntry),
    }),
  );
}
