import { requireEditionManager } from "@/lib/editionAuth";
import { listRegistrants } from "@/lib/registrations";
import { listQuestions, listRegistrantsWithAnswers, registrantsCsv } from "@/lib/registrationForm";

// inscritos da edição (admin global ou organizador da edição — spec 033).
// ?format=csv exporta com uma coluna por pergunta do formulário (US1).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const [questions, rows] = await Promise.all([
      listQuestions(id, { includeArchived: true }),
      listRegistrantsWithAnswers(id),
    ]);
    return new Response(registrantsCsv(questions, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inscritos-${id}.csv"`,
      },
    });
  }
  return Response.json({ registrations: await listRegistrants(id) });
}
