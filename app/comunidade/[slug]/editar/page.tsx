import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityForm } from "@/components/CommunityForm";
import { canManageCommunity, getCommunityBySlug } from "@/lib/communities";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "editar comunidade", robots: { index: false } };

// só dono, organizador ou admin global; pros outros a página não existe (404)
export default async function EditarComunidadePage({ params }: PageProps<"/comunidade/[slug]/editar">) {
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
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Editar comunidade</h1>
        <p className="font-mono text-[13px] text-muted">endereço: /comunidade/{c.slug}</p>
      </header>
      <CommunityForm
        slug={c.slug}
        initial={{
          name: c.name,
          description: c.description ?? "",
          city: c.city ?? "",
          online: c.online,
          website: c.website ?? "",
          instagram: c.instagram ?? "",
          linkedin: c.linkedin ?? "",
          discord: c.discord ?? "",
          groupUrl: c.groupUrl ?? "",
          logoUrl: c.logoUrl ?? "",
          coverUrl: c.coverUrl ?? "",
        }}
      />
    </section>
  );
}
