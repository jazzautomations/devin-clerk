import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JoinButton } from "@/components/CommunityActions";
import { TopicForm } from "@/components/TopicForm";
import { getCommunityBySlug, getMembership } from "@/lib/communities";
import { currentMember } from "@/lib/session";
import { listFlairs } from "@/lib/topics";

export const metadata: Metadata = { title: "novo tópico", robots: { index: false } };

// /comunidade/[slug]/t/novo — abrir tópico (migration 058). Só membro da
// comunidade; quem não é vê o motivo e o botão de entrar.

export default async function NewTopicPage({ params }: PageProps<"/comunidade/[slug]/t/novo">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  const [role, flairs] = await Promise.all([getMembership(c.id, member.id), listFlairs(c.id)]);

  return (
    <section className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-8 overflow-x-clip px-4 py-8 sm:px-6 sm:py-12" data-testid="topic-new-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}/t`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← tópicos de {c.name}
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Novo tópico</h1>
      </header>
      {role ? (
        <TopicForm slug={c.slug} flairs={flairs} />
      ) : (
        <div className="flex flex-col items-start gap-4 border-[1.5px] border-line px-5 py-6" data-testid="topic-new-join">
          <p className="text-[16px]">Só quem é da comunidade abre tópico. Entre e volte aqui.</p>
          <JoinButton slug={c.slug} member={false} />
        </div>
      )}
    </section>
  );
}
