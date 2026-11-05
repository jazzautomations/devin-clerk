import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedSection } from "@/components/FeedSection";
import { SpaceBar } from "@/components/SpaceBar";
import { getCommunityBySlug, getMembership } from "@/lib/communities";
import { getSpaceBySlug, listSpaces, postIdsBySpace, spaceEmptyHint, spacePostable, SPACE_POLICY_LABEL } from "@/lib/communitySpaces";
import { hydratePosts } from "@/lib/posts";
import { currentMember } from "@/lib/session";

// /comunidade/[slug]/s/[space] — o mural de um espaço (migration 057). Cada
// espaço é um recorte do mural da comunidade: quem entra vê só o que
// interessa. A barra de espaços fica em cima, com o ativo marcado; o
// composer já vem com o espaço selecionado. Arquivado ou inexistente: 404
// (os posts ficam, o espaço sai do ar). Exige conta (fora da allowlist).

export const metadata: Metadata = { title: "espaço da comunidade", robots: { index: false } };

export default async function SpacePage({ params }: PageProps<"/comunidade/[slug]/s/[space]">) {
  const { slug, space: spaceSlug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  const space = await getSpaceBySlug(c.id, spaceSlug);
  if (!space || space.archivedAt) notFound();
  const role = await getMembership(c.id, member.id);
  const isAdmin = member.role === "admin";
  const canManage = isAdmin || role === "dono" || role === "organizador";
  const canPost = spacePostable(space, role, canManage);
  const [spaces, posts] = await Promise.all([
    listSpaces(c.id),
    postIdsBySpace(space, member.id, null, 30, { includeHidden: isAdmin }).then((ids) => hydratePosts(ids, member.id)),
  ]);
  const postableSpaces = spaces.filter((sp) => spacePostable(sp, role, canManage)).map((sp) => ({ id: sp.id, slug: sp.slug, name: sp.name }));

  return (
    <section className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 overflow-x-clip px-4 py-8 sm:px-6 sm:py-12" data-testid="space-page">
      <header className="flex flex-col gap-4 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <div className="min-w-0">
          <p className="tag">ESPAÇO</p>
          <h1 className="mt-3 text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words" data-testid="space-title">
            #{space.slug}
          </h1>
          <p className="mt-2 max-w-[56ch] text-[15px] text-muted">
            {space.description ?? space.name}
            {space.postPolicy === "organizacao" && <span className="font-mono text-[12.5px]"> · {SPACE_POLICY_LABEL.organizacao}</span>}
          </p>
        </div>
      </header>

      <SpaceBar slug={c.slug} spaces={spaces} active={space.slug} canManage={canManage} />

      <FeedSection
        initialPosts={posts}
        canPost={canPost}
        me={member.username}
        isAdmin={isAdmin}
        communitySlug={c.slug}
        spaces={postableSpaces}
        spaceSlug={space.slug}
        emptyHint={spaceEmptyHint(space)}
        noPostHint={role && !canPost ? "só a organização posta neste espaço" : null}
      />
    </section>
  );
}
