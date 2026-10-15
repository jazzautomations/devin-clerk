import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { INCIDENT_KINDS, INCIDENT_KIND_LABEL } from "@/lib/incidents";
import { IncidentForm } from "@/components/IncidentForm";

export async function generateMetadata({ params }: PageProps<"/h/[id]/incidente">): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
  return { title: h ? `Relatar um problema · ${h.name}` : "relatar um problema", robots: { index: false } };
}

// frente L — canal de denúncia da edição (roadmap 037 #7). Público: dá pra
// relatar logado ou anônimo. Só a organização (e quem ela marcar como
// responsável de conduta) lê.
export default async function IncidentePage({ params }: PageProps<"/h/[id]/incidente">) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.hosted) notFound();
  const { userId } = await auth();
  const kinds = INCIDENT_KINDS.map((k) => ({ value: k, label: INCIDENT_KIND_LABEL[k] }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <Link href={`/h/${h.id}`} className="font-mono text-[13px] text-muted hover:text-accent">
          ← {h.name}
        </Link>
        <p className="font-mono text-[12px] tracking-widest text-accent uppercase">canal de conduta · sigiloso</p>
        <h1 className="text-[clamp(1.9rem,6vw,2.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em] break-words">
          Relatar um problema
        </h1>
        <p className="text-[15px] text-muted">
          Assédio, discriminação, algo que te deixou inseguro ou alguém precisando de ajuda. Quem lê é só a organização
          da edição. Em risco imediato, ligue <strong className="text-foreground">190</strong> (polícia) ou{" "}
          <strong className="text-foreground">192</strong> (SAMU) e procure a organização no local.
        </p>
        <Link href={`/h/${h.id}/conduta`} className="font-mono text-[13px] text-accent underline">
          ler o código de conduta
        </Link>
      </header>
      <IncidentForm hackathonId={h.id} kinds={kinds} signedIn={Boolean(userId)} />
    </div>
  );
}
