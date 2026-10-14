import Link from "next/link";
import { notFound } from "next/navigation";
import { IssueCertificatesButton } from "@/components/IssueCertificatesButton";
import { CERT_KIND_LABEL, CERT_KINDS, listEditionCertificates } from "@/lib/certificates";
import { getHackathon, isOver } from "@/lib/hackathons";
import { isPublished } from "@/lib/jury";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Aba certificados (spec 033 US6): a organização emite tudo de uma vez ao
// encerrar; reemitir só completa o que falta. Cada um tem link público.

export default async function CertificatesPanel({ params }: PageProps<"/admin/h/[id]/certificados">) {
  const { id } = await params;
  const [member, h] = await Promise.all([currentMember(), getHackathon(id)]);
  if (!member || !h || !(await canManageEdition(member, id))) notFound();
  const [certs, published] = await Promise.all([listEditionCertificates(id), isPublished(id)]);
  const over = isOver(h);
  const counts = CERT_KINDS.map((k) => [k, certs.filter((c) => c.kind === k).length] as const);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="max-w-2xl text-muted">
          Participação vai pra quem esteve presente; mentoria, júri e organização saem dos papéis da
          edição; premiação sai do resultado publicado do júri
          {published ? "" : " (ainda não publicado — premiação fica pra depois)"}. Emitir de novo não
          duplica: só cria o que falta.
        </p>
        <IssueCertificatesButton hackathonId={id} disabled={!over} />
        {!over && <p className="font-mono text-[12px] text-orange">A edição ainda não encerrou.</p>}
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
        <ul className="flex flex-col border-t-[1.5px] border-line">
          {certs.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2">
              <span className="min-w-0 break-words">
                {c.memberName}{" "}
                <span className="font-mono text-[12px] text-muted">
                  · {CERT_KIND_LABEL[c.kind]}
                  {c.detail ? ` · ${c.detail}` : ""}
                </span>
              </span>
              <Link href={`/c/${c.code}`} className="font-mono text-[12px] text-accent hover:underline">
                /c/{c.code}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
