import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SponsorOptIn } from "@/components/SponsorOptIn";
import { getEditionSponsor } from "@/lib/editionSponsors";
import { getHackathon } from "@/lib/hackathons";
import { currentMember } from "@/lib/session";
import { canOptIn, contactPreview, getOptIn, SHARED_FIELDS } from "@/lib/sponsorContacts";

export const metadata: Metadata = { title: "Compartilhar contato", robots: { index: false } };

// Opt-in de contato pro patrocinador (roadmap 037 #12) — o QR do estande
// cai aqui. Exige login (anon vai pro login e volta pra cá); logado e
// aprovado na edição vê exatamente o que iria e escolhe compartilhar/revogar.
export default async function SponsorOptInPage({ params }: PageProps<"/h/[id]/patrocinador/[sponsorId]">) {
  const { id, sponsorId } = await params;
  const back = `/h/${id}/patrocinador/${sponsorId}`;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: back });
  const [h, sponsor, member] = await Promise.all([
    getHackathon(id),
    getEditionSponsor(id, sponsorId),
    currentMember(),
  ]);
  if (!h || !h.active || !sponsor || !member) notFound();
  const [eligible, preview, state] = await Promise.all([
    canOptIn(id, member.id),
    contactPreview(id, member.id),
    getOptIn(id, sponsorId, member.id),
  ]);
  const values: Record<(typeof SHARED_FIELDS)[number], string | null> | null = preview
    ? {
        nome: preview.name,
        "e-mail": preview.email,
        LinkedIn: preview.linkedin,
        GitHub: preview.github,
        "projeto na edição": preview.project,
      }
    : null;

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-4 border-b-2 border-line pb-5">
        <Link href={`/h/${id}`} className="font-mono text-[13px] text-muted hover:text-accent">
          ← {h.name}
        </Link>
        {sponsor.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- logo remoto da marca; next/image exigiria remotePatterns
          <img src={sponsor.logoUrl} alt={`logo de ${sponsor.name}`} className="h-14 w-fit max-w-[220px] object-contain" />
        )}
        <h1 className="text-[clamp(1.9rem,6vw,2.6rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
          Compartilhar contato com {sponsor.name}
        </h1>
        <p className="text-[15px] text-muted">
          A marca só recebe números agregados da edição. Se você quiser que ela entre em contato (vaga, estágio,
          conversa sobre o projeto), compartilhe aqui. É opcional, fica registrado com data e você revoga quando quiser.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">o que vai pra {sponsor.name}</h2>
        <ul className="border-b border-line" data-testid="optin-fields">
          {SHARED_FIELDS.map((f) => (
            <li key={f} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line py-2">
              <span className="font-semibold">{f}</span>
              {values && (
                <span className="min-w-0 font-mono text-[13px] break-all text-muted">{values[f] || "não preenchido"}</span>
              )}
            </li>
          ))}
        </ul>
        {values && (
          <p className="text-[13px] text-muted">
            Os dados saem do seu <Link href="/perfil" className="text-accent underline">perfil</Link> na hora em que a marca
            abre o relatório. Nada além disso.
          </p>
        )}
      </div>

      {!eligible ? (
        <p className="border-[1.5px] border-line p-4 text-[15px]" data-testid="optin-not-eligible">
          Só quem tem inscrição aprovada em {h.name} compartilha contato por aqui.
        </p>
      ) : (
        <SponsorOptIn hackathonId={id} sponsorId={sponsorId} sponsorName={sponsor.name} initial={state} />
      )}
    </section>
  );
}
