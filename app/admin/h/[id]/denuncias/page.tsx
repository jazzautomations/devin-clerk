import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportQueue, reportTypeParam } from "@/components/ReportQueue";
import { canHandleReport, countOpenByType, listReports } from "@/lib/reports";
import { currentMember } from "@/lib/session";

// Denúncias do mural da edição (migration 032). Quem vê é quem trata
// incidentes: organização, responsável de conduta e admin global. Com a
// edição rolando, cada denúncia também vira um incidente na aba ao lado.

export default async function DenunciasEdicaoPage({ params, searchParams }: PageProps<"/admin/h/[id]/denuncias">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canHandleReport(member, { communityId: null, hackathonId: id }))) notFound();
  const type = reportTypeParam((await searchParams).tipo);
  const scope = { hackathonId: id };
  const [open, resolved, counts] = await Promise.all([
    listReports(scope, { type }),
    listReports(scope, { status: "resolved", limit: 20 }),
    countOpenByType(scope),
  ]);

  return (
    <section className="flex flex-col gap-6" data-testid="edition-reports-page">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">Denúncias</h2>
        <Link href={`/admin/h/${id}/incidentes`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          incidentes →
        </Link>
      </div>
      <p className="max-w-2xl text-[14px] text-muted">
        Posts e comentários do mural da edição que alguém denunciou. Durante o evento, cada uma também abre um incidente.
        O nome de quem denunciou não aparece.
      </p>
      <ReportQueue
        open={open}
        resolved={resolved}
        counts={counts}
        type={type}
        basePath={`/admin/h/${id}/denuncias`}
        empty="Nenhuma denúncia aberta nesta edição."
      />
    </section>
  );
}
