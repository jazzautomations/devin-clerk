import { buildHoursCsv, hoursCsvRows } from "@/lib/certificates";
import { editionGate } from "@/lib/juryHttp";
import { SITE_URL } from "@/lib/seo";

type Ctx = { params: Promise<{ id: string }> };

// CSV de hora complementar (roadmap 037 #2): certificados emitidos com
// carga horária, ordenados por instituição → curso → nome. BOM pra o Excel
// abrir acentuação certa. Só organização (tem e-mail e matrícula).
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const csv = buildHoursCsv(await hoursCsvRows(id), SITE_URL);
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="horas-complementares-${id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
