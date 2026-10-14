import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getHackathon, isOver } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { getEditionCapacity, getRegistrationStatus, getWaitlistPosition } from "@/lib/registrations";
import { consentPurpose, listQuestions } from "@/lib/registrationForm";
import { RegistrationForm } from "@/components/RegistrationForm";
import { KIND_LABEL, getMyApplications, type ApplicationKind } from "@/lib/roleApplications";

export async function generateMetadata({ params }: PageProps<"/h/[id]/inscricao">): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
  return { title: h ? `Inscrição · ${h.name}` : "inscrição", robots: { index: false } };
}

const STATUS_TEXT: Record<string, string> = {
  approved: "Você está inscrito nesta edição.",
  pending: "Seu pedido está com a curadoria. Você recebe a resposta por aqui.",
  rejected: "A curadoria não aprovou o pedido desta vez.",
  waitlist: "Você está na fila de espera. Se abrir vaga, a inscrição é confirmada sozinha.",
};

// spec 033 US1 — inscrição pelo formulário da edição (substitui o Google
// Forms). Pública pra leitura: anon vê as perguntas e o aceite; enviar pede login.
export default async function InscricaoPage({ params }: PageProps<"/h/[id]/inscricao">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active || !h.partner) notFound();

  const now = new Date();
  const closed = isOver(h, now) || (h.registrationDeadline !== null && new Date(h.registrationDeadline) < now);
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const [questions, purpose, cap, status, myApps] = await Promise.all([
    listQuestions(h.id),
    consentPurpose(h.id),
    getEditionCapacity(h.id),
    member ? getRegistrationStatus(member.id, h.id) : Promise.resolve(null),
    member ? getMyApplications(member.id, h.id) : Promise.resolve({}),
  ]);
  // frente E — candidato pendente/aprovado a voluntário/mentor/jurado não compete
  const helping = (Object.entries(myApps) as [ApplicationKind, string][]).find(([, st]) => st !== "rejected");
  const position = member && status === "waitlist" ? await getWaitlistPosition(member.id, h.id) : null;
  const full = !h.requiresApproval && cap.remaining === 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted hover:text-accent">
          ← {h.name}
        </Link>
        <p className="font-mono text-[12px] tracking-widest text-accent uppercase">
          inscrição · {h.requiresApproval ? "com curadoria" : "confirmação na hora"}
        </p>
        <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
          {h.name}
        </h1>
        <p className="text-[15px] text-muted">
          {questions.length > 0
            ? `${questions.length} ${questions.length === 1 ? "pergunta" : "perguntas"}, menos de 3 minutos.`
            : "Sem perguntas extras: é só aceitar os termos."}
          {cap.capacity !== null && (
            <>
              {" "}
              <span className="font-mono text-[13px] text-foreground" data-testid="capacity">
                {full ? "vagas esgotadas, fila de espera aberta" : `${cap.remaining} de ${cap.capacity} vagas`}
              </span>
            </>
          )}
        </p>
      </header>

      {status ? (
        <section className="flex flex-col gap-3 border-[1.5px] border-line bg-mint p-5">
          <p className="text-[17px] font-bold">{STATUS_TEXT[status]}</p>
          {position !== null && (
            <p className="pix text-[28px] leading-none">#{position} na fila</p>
          )}
          <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-accent underline">
            voltar pra edição
          </Link>
        </section>
      ) : helping ? (
        <p className="border-[1.5px] border-line p-5 text-[15px] text-muted" data-testid="register-blocked-helper">
          {`Você se candidatou como ${KIND_LABEL[helping[0]]} nesta edição. Quem ajuda não se inscreve como participante na mesma — se quiser trocar de lado, retire a candidatura pendente (ou fale com a organização) antes.`}{" "}
          <Link href={`/h/${h.id}/candidatura/${helping[0]}`} className="text-accent underline">
            ver candidatura
          </Link>
        </p>
      ) : closed ? (
        <p className="border-[1.5px] border-line p-5 font-mono text-[14px] text-muted">inscrições encerradas</p>
      ) : (
        <>
          <section className="flex flex-col gap-1.5 border-[1.5px] border-line p-4 text-[14px]">
            <p className="font-mono text-[12px] tracking-widest text-muted uppercase">do seu perfil</p>
            {member ? (
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted">nome</dt>
                <dd className="truncate font-semibold">{member.name ?? member.username}</dd>
                <dt className="text-muted">e-mail</dt>
                <dd className="truncate font-semibold">{member.email}</dd>
                <dt className="text-muted">github</dt>
                <dd className="truncate font-semibold">{member.github ?? "—"}</dd>
              </dl>
            ) : (
              <p>Nome, e-mail e GitHub vêm do seu cadastro no HackaHub. Você entra (ou cria a conta) ao enviar.</p>
            )}
            {member && (
              <Link href="/perfil" className="font-mono text-[12px] text-accent underline">
                ajustar no perfil
              </Link>
            )}
          </section>
          <RegistrationForm
            hackathonId={h.id}
            questions={questions}
            consentText={purpose.text}
            signedIn={Boolean(member)}
            requiresApproval={h.requiresApproval}
            full={full}
          />
        </>
      )}
    </div>
  );
}
