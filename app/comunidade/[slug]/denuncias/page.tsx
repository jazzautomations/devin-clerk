import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportQueue, reportTypeParam } from "@/components/ReportQueue";
import { getCommunityBySlug } from "@/lib/communities";
import { canHandleReport, countOpenByType, listReports } from "@/lib/reports";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "denúncias da comunidade", robots: { index: false } };

// Fila de denúncias da comunidade (migration 032): posts e comentários do
// mural dela. Só dono, organizador ou admin global; pros outros a página
// não existe. Denúncia contra a comunidade inteira vai pro admin, não pra cá.

export default async function DenunciasComunidadePage({ params, searchParams }: PageProps<"/comunidade/[slug]/denuncias">) {
  const { slug } = await params;
  const [member, c] = await Promise.all([currentMember(), getCommunityBySlug(slug)]);
  if (!member || !c || (c.hidden && member.role !== "admin")) notFound();
  if (!(await canHandleReport(member, { communityId: c.id, hackathonId: null }))) notFound();
  const type = reportTypeParam((await searchParams).tipo);
  const scope = { communityId: c.id, viewerId: member.id };
  const [open, resolved, counts] = await Promise.all([
    listReports(scope, { type }),
    listReports(scope, { status: "resolved", limit: 20 }),
    countOpenByType(scope),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 overflow-x-clip px-4 py-10 sm:px-6 sm:py-14" data-testid="community-reports-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/comunidade/${c.slug}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← {c.name}
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Denúncias</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          Posts e comentários do mural que alguém denunciou. Só a organização da comunidade e a equipe do HackaHub veem
          esta fila, e o nome de quem denunciou não aparece.
        </p>
      </header>
      <ReportQueue
        open={open}
        resolved={resolved}
        counts={counts}
        type={type}
        basePath={`/comunidade/${c.slug}/denuncias`}
        empty="Nenhuma denúncia aberta no mural."
      />
    </section>
  );
}
