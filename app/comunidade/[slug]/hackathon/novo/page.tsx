import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityHackathonForm } from "@/components/CommunityHackathonForm";
import { canManageCommunity, getCommunityBySlug } from "@/lib/communities";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "abrir hackathon", robots: { index: false } };

// só dono, organizador ou admin global (os outros recebem 404)
export default async function NovoHackathonPage({ params }: PageProps<"/comunidade/[slug]/hackathon/novo">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  if (!(await canManageCommunity(member, c.id))) notFound();
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <p className="tag self-start">NOVO HACKATHON</p>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Abra o hackathon.</h1>
        <ol className="mt-1 flex flex-col gap-1 font-mono text-[13px] text-muted">
          <li>1. o básico aqui</li>
          <li>2. formulário, prazos e equipe no painel</li>
          <li>3. publicar: quem está na {c.name} recebe o aviso</li>
        </ol>
      </header>
      <CommunityHackathonForm slug={c.slug} city={c.city} />
    </section>
  );
}
