import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { SponsorReportView } from "@/components/SponsorReportView";
import { getEditionSponsor } from "@/lib/editionSponsors";
import { currentMember } from "@/lib/session";
import { canViewSponsorReport } from "@/lib/sponsorAuth";
import { getSponsorReport } from "@/lib/sponsorReport";

export const metadata: Metadata = { title: "Relatório do patrocinador", robots: { index: false } };

// Relatório automático do patrocinador (roadmap 037 #8). Organizador vê o de
// qualquer marca da edição; a pessoa da marca vê só o dela — a de outra
// marca dá 404 (não confirma nem que existe).
export default async function SponsorReportPage({ params }: PageProps<"/admin/h/[id]/patrocinador/[sponsorId]">) {
  const { id, sponsorId } = await params;
  const member = await currentMember();
  if (!member || !(await getEditionSponsor(id, sponsorId))) notFound();
  const { allowed, manager } = await canViewSponsorReport(member, id, sponsorId);
  if (!allowed) notFound();
  const report = await getSponsorReport(id, sponsorId, { manager });
  if (!report) notFound();
  return (
    <SponsorReportView
      report={report}
      csvHref={`/api/admin/hackathons/${id}/sponsors/${sponsorId}/report?format=csv`}
      actions={<PrintButton />}
    />
  );
}
