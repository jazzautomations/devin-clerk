import { requireEditionStaff } from "@/lib/staffAuth";
import { mealReport, mealsCsv } from "@/lib/eventTerms";

// relatório pro buffet (roadmap 037 #6): contagem por restrição só dos
// aprovados (?presentes=1 → só quem fez check-in) e alergias, graves
// primeiro. ?format=csv baixa a planilha. Organizador e staff.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionStaff(id);
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const checkedInOnly = url.searchParams.get("presentes") === "1";
  const report = await mealReport(id, { checkedInOnly });
  if (url.searchParams.get("format") === "csv") {
    return new Response(mealsCsv(report, { checkedInOnly }), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="refeicoes-${id}${checkedInOnly ? "-presentes" : ""}.csv"`,
      },
    });
  }
  return Response.json(report);
}
