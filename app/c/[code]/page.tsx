import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CERT_KIND_LABEL, formatCertDate, getCertificate } from "@/lib/certificates";

// Verificação pública do certificado (spec 033 US6): quem recebe o PDF abre
// esse link e confere nome, edição, tipo e data. Não indexa — é dado pessoal.

export async function generateMetadata({ params }: PageProps<"/c/[code]">): Promise<Metadata> {
  const { code } = await params;
  const c = await getCertificate(code);
  return {
    title: c ? `Certificado ${c.code}` : "certificado não encontrado",
    robots: { index: false, follow: false },
  };
}

export default async function CertificatePage({ params }: PageProps<"/c/[code]">) {
  const { code } = await params;
  const c = await getCertificate(code);
  if (!c) notFound();

  const rows: [string, ReactNode][] = [
    [
      "edição",
      <Link key="h" href={`/h/${c.hackathonId}`} className="text-accent underline-offset-4 hover:underline">
        {c.hackathonName}
      </Link>,
    ],
    ["tipo", CERT_KIND_LABEL[c.kind]],
    ...(c.detail ? ([["detalhe", c.detail]] as [string, string][]) : []),
    ["data da edição", `${formatCertDate(c.startsAt)}${c.location ? ` · ${c.location}` : ""}`],
    ["emitido em", formatCertDate(c.issuedAt)],
    ["código", <span key="c" className="font-mono text-accent">{c.code}</span>],
  ];

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
      <div className="window paper">
        <div className="tbar">
          <span className="title">verificação de certificado</span>
          <span className="dots" aria-hidden>
            <b />
            <b />
            <b />
          </span>
        </div>
        <div className="flex flex-col gap-6 p-5 font-sans sm:p-8">
          <p className="self-start border-[1.5px] border-accent bg-mint px-3 py-1 font-mono text-[12px] tracking-widest text-accent uppercase">
            certificado válido
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
              certificado de {CERT_KIND_LABEL[c.kind]} emitido para
            </p>
            <h1 className="text-[clamp(2rem,6vw,3.25rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
              {c.memberName}
            </h1>
            <Link href={`/u/${c.username}`} className="font-mono text-xs text-muted hover:text-accent">
              @{c.username}
            </Link>
          </div>
          <dl className="grid grid-cols-1 border-t-[1.5px] border-line sm:grid-cols-[10rem_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="pt-3 font-mono text-[12px] tracking-widest text-muted uppercase sm:border-b sm:border-line sm:py-3">
                  {k}
                </dt>
                <dd className="border-b border-line pb-3 break-words sm:py-3">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-3">
            <a href={`/c/${c.code}/pdf`} className="btn">
              baixar PDF
            </a>
            <Link href={`/h/${c.hackathonId}`} className="btn-ghost">
              ver a edição
            </Link>
          </div>
        </div>
      </div>
      <p className="font-mono text-xs text-muted">
        Emitido pela organização da Hack Inova no HackaHub. O código acima é único e
        confere com o PDF.
      </p>
    </section>
  );
}
