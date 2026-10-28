import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listComments } from "@/lib/comments";
import { parseId } from "@/lib/ids";
import { getPost } from "@/lib/posts";
import { currentMember } from "@/lib/session";
import { PostView } from "./PostView";

// Endereço do post (migration 034). Página logada: o post, a conversa com
// respostas em 1 nível e a caixa de comentar. Notificação de reação e de
// comentário cai aqui, já na âncora #c-<id>. 404 quando o post não existe,
// é de comunidade escondida (só o admin vê) ou um dos dois bloqueou o outro.

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parseId((await params).id);
  const me = await currentMember();
  const post = id === null || !me ? null : await getPost(id, me.id);
  if (!post) return { title: "post não encontrado", robots: { index: false } };
  return { title: `Post de @${post.username}`, robots: { index: false } };
}

export default async function PostPage({ params }: Props) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const me = await currentMember();
  if (!me) notFound();
  const post = await getPost(id, me.id);
  if (!post) notFound();
  const comments = await listComments(post.id, me.id);
  const back = post.communitySlug
    ? { href: `/comunidade/${post.communitySlug}`, label: post.communityName ?? "comunidade" }
    : post.hackathonId
      ? { href: `/h/${post.hackathonId}`, label: post.hackathonName ?? "edição" }
      : { href: "/feed", label: "feed" };

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14" data-testid="post-page">
      <nav aria-label="Voltar" className="font-mono text-[13px]">
        <Link href={back.href} className="text-accent underline-offset-4 hover:underline">
          ← {back.label}
        </Link>
      </nav>
      <PostView post={post} comments={comments} me={{ id: me.id, username: me.username, role: me.role }} backHref={back.href} />
    </section>
  );
}
