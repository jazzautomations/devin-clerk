import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { EntryEditor } from "@/components/EntryEditor";
import { getChallenges } from "@/lib/challenges";
import { formatBrt, lockAt, myEntry, TECH_SUGGESTIONS, toDbTime } from "@/lib/entries";
import { getHackathon } from "@/lib/hackathons";
import { listCriteria } from "@/lib/jury";
import { getMemberByClerkId } from "@/lib/members";

// spec 034 — onde o time monta e envia a entrega: rascunho com autosave,
// envio versionado, trava no prazo e "depois do hackathon".

export const metadata: Metadata = { title: "entrega do projeto", robots: { index: false } };

export default async function EntryPage({ params }: PageProps<"/h/[id]/entrega">) {
  const { id } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/entrega` });
  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const member = await getMemberByClerkId(userId);
  if (!member) return redirectToSignIn({ returnBackUrl: `/h/${id}/entrega` });

  const [entry, criteria, challenges] = await Promise.all([
    myEntry(id, member.username),
    listCriteria(id),
    getChallenges(id),
  ]);
  const lock = entry ? lockAt(entry.settings) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
          <Link href={`/h/${id}`} className="hover:text-accent">
            {h.name}
          </Link>{" "}
          · entrega do projeto
        </p>
        <h1 className="text-[clamp(1.8rem,5vw,2.6rem)] leading-none font-extrabold tracking-[-0.035em] break-words">
          {entry ? entry.teamName : "Sem time ainda"}
        </h1>
        {lock && (
          <p className="font-mono text-[13px] text-muted">
            prazo {formatBrt(entry!.settings.submissionDeadline)}
            {entry!.settings.submissionGraceMinutes > 0 && ` (trava às ${formatBrt(toDbTime(lock))})`} · horário de Brasília
          </p>
        )}
      </header>
      {entry ? (
        <EntryEditor
          hackathonId={id}
          initial={entry}
          rubric={criteria.map((c) => c.label)}
          challenges={challenges.map((c) => ({ id: c.id, title: c.title, sponsor: c.sponsor }))}
          techSuggestions={TECH_SUGGESTIONS}
        />
      ) : (
        <p className="border-[1.5px] border-line px-5 py-6 text-muted">
          Você ainda não tem time nesta edição.{" "}
          <Link href={`/h/${id}#meu-time`} className="text-accent underline underline-offset-4">
            Crie o time na página da edição
          </Link>{" "}
          e volte aqui pra montar a entrega.
        </p>
      )}
    </div>
  );
}
