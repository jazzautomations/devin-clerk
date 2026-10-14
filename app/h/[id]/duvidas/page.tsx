import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { currentMember } from "@/lib/session";
import { canModerateQuestions, canUseQuestions, listQuestions } from "@/lib/questions";
import { formatDbTime } from "@/lib/format";
import { QuestionThread } from "@/components/QuestionThread";

export const metadata: Metadata = { title: "Dúvidas da edição", robots: { index: false } };

// spec 033 US3 — canal de dúvidas da edição. Anon vai pro login; logado sem
// inscrição (nem papel) vê o convite pra se inscrever, não a thread.
export default async function DuvidasPage({ params }: PageProps<"/h/[id]/duvidas">) {
  const { id } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/duvidas` });
  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const member = await currentMember();
  const allowed = await canUseQuestions(member, id);
  const [canModerate, questions] = allowed
    ? await Promise.all([canModerateQuestions(member, id), listQuestions(id)])
    : [false, []];
  const withWhen = questions.map((q) => ({ ...q, when: formatDbTime(q.createdAt) }));

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${id}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {h.name}
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-none font-extrabold tracking-[-0.04em]">Dúvidas</h1>
        <p className="text-[15px] text-muted">
          Pergunta aqui em vez de no grupo. A organização e os mentores respondem e marcam o que já foi resolvido.
        </p>
      </header>
      {allowed ? (
        <QuestionThread hackathonId={id} questions={withWhen} canAsk canModerate={canModerate} />
      ) : (
        <div className="flex flex-col gap-3 border-[1.5px] border-line p-5">
          <p className="font-semibold">As dúvidas são só pra quem está inscrito nesta edição.</p>
          <Link href={`/h/${id}`} className="btn w-fit rounded-[6px]">
            ver a edição e se inscrever
          </Link>
        </div>
      )}
    </section>
  );
}
