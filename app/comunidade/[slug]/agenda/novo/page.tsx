import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MeetupForm } from "@/components/MeetupForm";
import { canManageCommunity, getCommunityBySlug } from "@/lib/communities";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "marcar evento", robots: { index: false } };

// só dono, organizador ou admin global (os outros recebem 404)
export default async function NovoEventoPage({ params }: PageProps<"/comunidade/[slug]/agenda/novo">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  if (!(await canManageCommunity(member, c.id))) notFound();
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}/agenda`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← agenda da {c.name}
        </Link>
        <p className="tag self-start">NOVO EVENTO</p>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Marque na agenda.</h1>
        <p className="max-w-[52ch] text-[15.5px] text-muted">
          Quem é membro ou segue a {c.name} recebe o aviso quando você publicar. A página do evento tem RSVP e o arquivo pra agenda do celular.
        </p>
      </header>
      <MeetupForm slug={c.slug} city={c.city} />
    </section>
  );
}
