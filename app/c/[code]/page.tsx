import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { CERT_KIND_LABEL, certPeriod, certRoleLabel, formatCertDate, formatHours, getCertificate } from "@/lib/certificates";
import { ShareBar } from "@/components/ShareBar";
import { absoluteUrl } from "@/lib/seo";
import { linkedinAddCertificationUrl } from "@/lib/social";

// Verificação pública do certificado (spec 033 US6): quem recebe o PDF abre
// esse link e confere nome, edição, tipo e data. Não indexa — é dado pessoal.
// roadmap 037 #2 — mostra também papel, carga horária, período e instituição
// promotora, congelados na emissão: é aqui que o coordenador confere a hora
// complementar.

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

  const certUrl = absoluteUrl(`/c/${c.code}`);
  const kindLabel = CERT_KIND_LABEL[c.kind];
  const certName = `${kindLabel[0].toUpperCase()}${kindLabel.slice(1)} — ${c.hackathonName}`;
  const role = certRoleLabel(c);
  const addToLinkedin = linkedinAddCertificationUrl({
    name: certName,
    organizationName: c.institution || "HackaHub",
    issuedAt: c.issuedAt,
    certUrl,
    certId: c.code,
  });

  const rows: [string, ReactNode][] = [
    [
      "edição",
      <Link key="h" href={`/h/${c.hackathonId}`} className="text-accent underline-offset-4 hover:underline">
        {c.hackathonName}
      </Link>,
    ],
    ["tipo", CERT_KIND_LABEL[c.kind]],
    ...(role ? ([["papel", role]] as [string, string][]) : []),
    ...(c.hours !== null
      ? ([["carga horária", <span key="hrs" data-testid="cert-hours">{formatHours(c.hours)}</span>]] as [string, ReactNode][])
      : []),
    ...(c.detail ? ([["detalhe", c.detail]] as [string, string][]) : []),
    ["período", `${certPeriod(c)}${c.location ? ` · ${c.location}` : ""}`],
    ["instituição", c.institution],
    ["emitido em", formatCertDate(c.issuedAt)],
    ...(c.revokedAt ? ([["revogado em", formatCertDate(c.revokedAt)]] as [string, string][]) : []),
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
          {c.revokedAt ? (
            <div className="flex flex-col gap-2" data-testid="cert-revoked">
              <p className="self-start border-[1.5px] border-orange px-3 py-1 font-mono text-[12px] tracking-widest text-orange uppercase">
                certificado revogado
              </p>
              <p className="text-[15px] text-muted">
                Este código não vale mais. A organização republicou o resultado ou corrigiu o certificado, e a
                versão vigente, quando existe, tem outro código.
              </p>
            </div>
          ) : (
            <p className="self-start border-[1.5px] border-accent bg-mint px-3 py-1 font-mono text-[12px] tracking-widest text-accent uppercase">
              certificado válido
            </p>
          )}
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
          {!c.revokedAt && (
          <div className="flex flex-wrap gap-3">
            <a href={`/c/${c.code}/pdf`} className="btn">
              baixar PDF
            </a>
            <a href={addToLinkedin} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              adicionar ao LinkedIn
            </a>
            <Link href={`/h/${c.hackathonId}`} className="btn-ghost">
              ver a edição
            </Link>
          </div>
          )}
          {!c.revokedAt && (
            <ShareBar url={certUrl} text={`Certificado de ${kindLabel} — ${c.hackathonName}${c.institution ? ` (${c.institution})` : ""}`} label="compartilhar certificado" />
          )}
        </div>
      </div>
      <p className="font-mono text-xs text-muted">
        Emitido por {c.institution} no HackaHub. O código acima é único e confere com o PDF;
        carga horária e papel ficam congelados na emissão.
      </p>
    </section>
  );
}
