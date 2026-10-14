import Link from "next/link";
import { notFound } from "next/navigation";
import { IssueCertificatesButton } from "@/components/IssueCertificatesButton";
import { CertificateSettingsForm } from "@/components/CertificateSettingsForm";
import {
  CERT_KIND_LABEL,
  CERT_KINDS,
  certRoleLabel,
  formatHours,
  listEditionCertificates,
} from "@/lib/certificates";
import {
  CERT_ROLE_LABEL,
  CERT_ROLES,
  defaultEditionHours,
  getCertSettings,
  hoursFor,
  resolveQuestionMapping,
} from "@/lib/certHours";
import { getHackathon, isOver } from "@/lib/hackathons";
import { isPublished } from "@/lib/jury";
import { listQuestions } from "@/lib/registrationForm";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Aba certificados (spec 033 US6): a organização emite tudo de uma vez ao
// encerrar; reemitir só completa o que falta. Cada um tem link público.
// roadmap 037 #2: carga horária por papel, presença mínima, instituição e
// CSV de hora complementar por curso/instituição.

const h2 = "font-mono text-[12px] tracking-widest text-muted uppercase";

export default async function CertificatesPanel({ params }: PageProps<"/admin/h/[id]/certificados">) {
  const { id } = await params;
  const [member, h] = await Promise.all([currentMember(), getHackathon(id)]);
  if (!member || !h || !(await canManageEdition(member, id))) notFound();
  const [certs, published, settings, questions] = await Promise.all([
    listEditionCertificates(id),
    isPublished(id),
    getCertSettings(id),
    listQuestions(id),
  ]);
  const over = isOver(h);
  const counts = CERT_KINDS.map((k) => [k, certs.filter((c) => c.kind === k).length] as const);
  const defaultHours = defaultEditionHours(h.startsAt, h.endsAt);
  const detected = resolveQuestionMapping(questions, settings);
  const effective = CERT_ROLES.map((r) => ({
    role: r,
    label: CERT_ROLE_LABEL[r],
    hours: hoursFor(settings, h, r),
    custom: settings.hours[r] !== null,
  }));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="max-w-2xl text-muted">
          Participação vai pra quem esteve presente
          {settings.requireLockedEntry ? " e tem entrega do time enviada até a trava" : ""}; voluntariado/staff,
          mentoria, júri e organização saem dos papéis da edição; premiação sai do resultado publicado do júri
          {published ? "" : " (ainda não publicado — premiação fica pra depois)"}. Emitir de novo não duplica: só
          cria o que falta.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]" data-testid="effective-hours">
          {effective.map((e) => (
            <li key={e.role}>
              {e.label} <span className={e.custom ? "text-accent" : "text-muted"}>{formatHours(e.hours)}</span>
            </li>
          ))}
        </ul>
        <IssueCertificatesButton hackathonId={id} disabled={!over} />
        {!over && <p className="font-mono text-[12px] text-orange">A edição ainda não encerrou.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={h2}>configuração</h2>
        <CertificateSettingsForm
          hackathonId={id}
          roles={CERT_ROLES.map((r) => ({ role: r, label: CERT_ROLE_LABEL[r] }))}
          defaultHours={defaultHours}
          initial={settings}
          institutionDefault={h.organizer}
          questions={questions.map((q) => ({ id: q.id, label: q.label }))}
          detected={detected}
        />
      </section>

      <dl className="grid grid-cols-2 border-[1.5px] border-line sm:grid-cols-5">
        {counts.map(([k, n]) => (
          <div key={k} className="flex flex-col gap-1 border-line p-4 not-last:border-b sm:not-last:border-r sm:not-last:border-b-0">
            <dt className="font-mono text-[11px] tracking-widest text-muted uppercase">{CERT_KIND_LABEL[k]}</dt>
            <dd className="pix text-3xl">{n}</dd>
          </div>
        ))}
      </dl>

      {certs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className={h2}>emitidos</h2>
            <a href={`/api/admin/hackathons/${id}/certificados/csv`} className="btn-ghost" download>
              baixar CSV de hora complementar
            </a>
          </div>
          <ul className="flex flex-col border-t-[1.5px] border-line">
            {certs.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2">
                <span className="min-w-0 break-words">
                  {c.memberName}{" "}
                  <span className="font-mono text-[12px] text-muted">
                    · {certRoleLabel(c) ?? CERT_KIND_LABEL[c.kind]}
                    {c.hours !== null ? ` · ${formatHours(c.hours)}` : ""}
                    {c.detail ? ` · ${c.detail}` : ""}
                  </span>
                </span>
                <Link href={`/c/${c.code}`} className="font-mono text-[12px] text-accent hover:underline">
                  /c/{c.code}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
