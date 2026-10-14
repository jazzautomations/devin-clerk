import { requireSponsorViewer } from "@/lib/sponsorAuth";
import { getSponsorReport, sponsorReportCsv } from "@/lib/sponsorReport";

// Relatório do patrocinador (roadmap 037 #8): organizador vê qualquer marca
// da edição; quem é da marca vê só a sua (403 pra de outra). ?format=csv baixa.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; sponsorId: string }> }) {
  const { id, sponsorId } = await params;
  const g = await requireSponsorViewer(id, sponsorId);
  if ("response" in g) return g.response;
  const report = await getSponsorReport(id, sponsorId, { manager: g.manager });
  if (!report) return Response.json({ error: "Patrocinador não encontrado nesta edição" }, { status: 404 });
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response(sponsorReportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-${id}-${sponsorId}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
}
