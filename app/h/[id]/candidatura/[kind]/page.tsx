import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getHackathon, isOver } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { getRegistrationStatus } from "@/lib/registrations";
import { consentPurpose, listQuestions } from "@/lib/registrationForm";
import { getEditionRoles } from "@/lib/roles";
import {
  KIND_LABEL,
  KIND_PITCH,
  KIND_ROLE,
  getMyApplications,
  getOpenKinds,
  isApplicationKind,
} from "@/lib/roleApplications";
import { RegistrationForm } from "@/components/RegistrationForm";
import { WithdrawApplicationButton } from "@/components/WithdrawApplicationButton";

export async function generateMetadata({ params }: PageProps<"/h/[id]/candidatura/[kind]">): Promise<Metadata> {
  const { id, kind } = await params;
  const h = await getHackathon(id);
  const label = isApplicationKind(kind) ? KIND_LABEL[kind] : "candidatura";
  return { title: h ? `Candidatura de ${label} · ${h.name}` : "candidatura", robots: { index: false } };
}

// frente E (spec 033) — candidatura a voluntário/mentor/jurado. Logado:
// formulário daquele tipo + aceite LGPD com a finalidade da candidatura.
export default async function CandidaturaPage({ params }: PageProps<"/h/[id]/candidatura/[kind]">) {
  const { id, kind } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: `/h/${id}/candidatura/${kind}` });
  const h = await getHackathon(id);
  if (!h || !h.active || !h.hosted || !isApplicationKind(kind)) notFound();
  const member = await getMemberByClerkId(userId);
  if (!member) notFound();

  const [open, mine, regStatus, roles, questions, purpose] = await Promise.all([
    getOpenKinds(h.id),
    getMyApplications(member.id, h.id),
    getRegistrationStatus(member.id, h.id),
    getEditionRoles(h.id, member.id),
    listQuestions(h.id, { audience: kind }),
    consentPurpose(h.id, kind),
  ]);
  const label = KIND_LABEL[kind];
  const status = mine[kind] ?? null;
  const competing = regStatus !== null && regStatus !== "rejected";
  const hasRole = roles.includes("organizador") || roles.includes(KIND_ROLE[kind]);

  const blocked = isOver(h)
    ? "edição encerrada"
    : !open.includes(kind)
      ? `candidaturas de ${label} fechadas nesta edição`
      : competing
        ? "Você está inscrito como participante nesta edição. Quem compete não ajuda na mesma edição — se quiser trocar de lado, cancele a inscrição antes."
        : hasRole
          ? `Você já é ${label} nesta edição.`
          : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted hover:text-accent">
          ← {h.name}
        </Link>
        <p className="font-mono text-[12px] tracking-widest text-accent uppercase">candidatura · {label}</p>
        <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
          Quero ser {label}
        </h1>
        <p className="text-[15px] text-muted">
          {KIND_PITCH[kind]} A organização de {h.organizer} lê e responde por aqui.
        </p>
      </header>

      {status ? (
        <section
          data-testid="application-status"
          className={`flex flex-col gap-3 border-[1.5px] border-line p-5 ${status === "rejected" ? "" : "bg-mint"}`}
        >
          <p className="text-[17px] font-bold">
            {status === "pending"
              ? "Candidatura recebida. A organização decide e você recebe a resposta nas notificações."
              : status === "approved"
                ? `Candidatura aprovada: você é ${label} nesta edição.`
                : "A organização não aprovou a candidatura desta vez."}
          </p>
          {status === "approved" && (
            <Link href={`/admin/h/${h.id}`} className="font-mono text-[13px] text-accent underline">
              abrir o painel da edição
            </Link>
          )}
          {status === "pending" && <WithdrawApplicationButton hackathonId={h.id} kind={kind} />}
          <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-accent underline">
            voltar pra edição
          </Link>
        </section>
      ) : blocked ? (
        <p className="border-[1.5px] border-line p-5 text-[15px] text-muted" data-testid="application-blocked">
          {blocked}
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-1.5 border-[1.5px] border-line p-4 text-[14px]">
            <p className="font-mono text-[12px] tracking-widest text-muted uppercase">do seu perfil</p>
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted">nome</dt>
              <dd className="truncate font-semibold">{member.name ?? member.username}</dd>
              <dt className="text-muted">e-mail</dt>
              <dd className="truncate font-semibold">{member.email}</dd>
              <dt className="text-muted">github</dt>
              <dd className="truncate font-semibold">{member.github ?? "—"}</dd>
            </dl>
            <Link href="/perfil" className="font-mono text-[12px] text-accent underline">
              ajustar no perfil
            </Link>
          </section>
          <p className="text-[13px] text-muted">
            Quem ajuda não compete: com a candidatura pendente ou aprovada você não se inscreve como participante
            desta edição.
          </p>
          <RegistrationForm
            hackathonId={h.id}
            questions={questions}
            consentText={purpose.text}
            signedIn
            target={{
              submitUrl: `/api/hackathons/${h.id}/applications/${kind}`,
              cta: `enviar candidatura de ${label}`,
              pagePath: `/h/${h.id}/candidatura/${kind}`,
            }}
          />
        </>
      )}
    </div>
  );
}
