import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TopicThread, type ThreadReply } from "@/components/TopicThread";
import { renderUserMarkdown } from "@/lib/blog";
import { parseId } from "@/lib/ids";
import { currentMember } from "@/lib/session";
import { getTopic, listFlairs, listReplies, parseReplySort, type TopicReply } from "@/lib/topics";

export const metadata: Metadata = { title: "tópico", robots: { index: false } };

// /comunidade/[slug]/t/[topicId] — um tópico e a conversa dele (migration
// 058). O markdown é renderizado aqui (renderUserMarkdown, sem HTML do
// usuário) e a árvore vai pronta pro TopicThread. Endereço com o slug
// errado redireciona pro certo.

function withHtml(list: TopicReply[]): ThreadReply[] {
  return list.map((r) => ({ ...r, html: r.body ? renderUserMarkdown(r.body) : "", children: withHtml(r.children) }));
}

export default async function TopicPage({ params, searchParams }: PageProps<"/comunidade/[slug]/t/[topicId]">) {
  const { slug, topicId } = await params;
  const sp = await searchParams;
  const member = await currentMember();
  const id = parseId(topicId);
  const topic = member && id !== null ? await getTopic(id, member) : null;
  if (!member || !topic) notFound();
  if (topic.communitySlug !== slug) redirect(`/comunidade/${topic.communitySlug}/t/${topic.id}`);
  const sort = parseReplySort(Array.isArray(sp.ordem) ? sp.ordem[0] : sp.ordem);
  const [replies, flairs] = await Promise.all([
    listReplies(topic.id, member, { sort, canModerate: topic.canModerate, acceptedReplyId: topic.acceptedReplyId }),
    topic.canModerate ? listFlairs(topic.communityId) : Promise.resolve([]),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 overflow-x-clip px-4 py-8 sm:px-6 sm:py-12" data-testid="topic-page">
      <nav className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[13px]" aria-label="caminho">
        <Link href={`/comunidade/${topic.communitySlug}`} className="max-w-full truncate text-accent underline-offset-4 hover:underline">
          {topic.communityName}
        </Link>
        <span aria-hidden="true" className="text-muted">
          /
        </span>
        <Link href={`/comunidade/${topic.communitySlug}/t`} className="text-accent underline-offset-4 hover:underline">
          tópicos
        </Link>
      </nav>
      <TopicThread
        topic={{ ...topic, html: topic.body ? renderUserMarkdown(topic.body) : "" }}
        replies={withHtml(replies)}
        me={{ id: member.id, username: member.username }}
        sort={sort}
        flairs={flairs}
      />
    </section>
  );
}
