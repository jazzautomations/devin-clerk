import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { NpsForm } from "@/components/NpsForm";
import { formatBrt, toDbTime } from "@/lib/entries";
import { getHackathon } from "@/lib/hackathons";
import { getMyNps, getNpsWindow, npsPhase, npsRoleFor, NPS_QUESTIONS, NPS_TEXT_MAX } from "@/lib/nps";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "Pesquisa da edição", robots: { index: false } };

// Pesquisa NPS de quem esteve na edição (roadmap 037 #11). Anon vai pro
// login; sem check-in nem papel vê o aviso; fora da janela vê o estado.
export default async function NpsSurveyPage({ params }: PageProps<"/h/[id]/nps">) {
  const { id } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/nps` });
  const [h, member, w] = await Promise.all([getHackathon(id), currentMember(), getNpsWindow(id)]);
  if (!h || !h.active || !member || !w) notFound();
  const [role, answer] = await Promise.all([npsRoleFor(id, member.id), getMyNps(id, member.id)]);
  const phase = npsPhase(w);
  const closes = w.closesAt ? formatBrt(toDbTime(w.closesAt)) : null;

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${id}`} className="font-mono text-[13px] text-muted hover:text-accent">
          ← {h.name}
        </Link>
        <h1 className="text-[clamp(1.9rem,6vw,2.6rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
          Como foi a edição?
        </h1>
        <p className="text-[15px] text-muted">
          Um minuto. A organização vê só o agregado e os comentários, sem o seu nome.
          {closes && phase === "aberta" ? ` Dá pra editar até ${closes}.` : ""}
        </p>
      </header>
      {!role ? (
        <p className="border-[1.5px] border-line p-4 text-[15px]" data-testid="nps-not-eligible">
          A pesquisa é pra quem esteve na edição: participante com check-in ou quem teve papel (staff, mentor, jurado,
          patrocinador).
        </p>
      ) : phase === "antes" ? (
        <p className="border-[1.5px] border-line p-4 text-[15px]" data-testid="nps-closed">
          A pesquisa abre quando a edição terminar.
        </p>
      ) : phase === "encerrada" ? (
        <p className="border-[1.5px] border-line p-4 text-[15px]" data-testid="nps-closed">
          A pesquisa fechou{closes ? ` em ${closes}` : ""}. {answer ? `Sua nota foi ${answer.score}. ` : ""}Obrigado!
        </p>
      ) : (
        <NpsForm hackathonId={id} questions={NPS_QUESTIONS[role]} initial={answer} maxLength={NPS_TEXT_MAX} />
      )}
    </section>
  );
}
