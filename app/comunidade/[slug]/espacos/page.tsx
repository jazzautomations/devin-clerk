import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpaceAdmin } from "@/components/SpaceAdmin";
import { getCommunityBySlug, getMembership } from "@/lib/communities";
import { listSpaces, SPACE_LIMITS } from "@/lib/communitySpaces";
import { currentMember } from "@/lib/session";

// /comunidade/[slug]/espacos — gestão dos espaços (migration 057), pra
// dono, organizador e admin: criar, renomear, ordenar com setas e
// arquivar/desarquivar. Membro comum e visitante: 404.

export const metadata: Metadata = { title: "espaços da comunidade", robots: { index: false } };

export default async function SpacesAdminPage({ params }: PageProps<"/comunidade/[slug]/espacos">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  const role = await getMembership(c.id, member.id);
  const canManage = member.role === "admin" || role === "dono" || role === "organizador";
  if (!canManage) notFound();
  const spaces = await listSpaces(c.id, { includeArchived: true });

  return (
    <section className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 overflow-x-clip px-4 py-8 sm:px-6 sm:py-12" data-testid="spaces-page">
      <header className="flex flex-col gap-4 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="self-start font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <div className="min-w-0">
          <p className="tag">COMUNIDADE</p>
          <h1 className="mt-3 text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words">Espaços</h1>
          <p className="mt-2 max-w-[56ch] text-[15px] text-muted">
            O mural se divide em espaços. Cada comunidade tem até {SPACE_LIMITS.active} ativos; arquivar esconde do seletor e mantém os posts.
          </p>
        </div>
      </header>
      <SpaceAdmin slug={c.slug} spaces={spaces} />
    </section>
  );
}
