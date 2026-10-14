import { requireEditionManager } from "@/lib/editionAuth";
import { setEditionCapacity } from "@/lib/registrations";

// spec 033 FR-009 — vagas da edição. null = sem limite. Aumentar promove a
// fila de espera na hora (promoted volta pra UI mostrar quem subiu).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const b = (await req.json().catch(() => null)) as { capacity?: unknown } | null;
  const c = b?.capacity;
  if (c !== null && !(typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 100_000)) {
    return Response.json(
      { error: "capacidade deve ser um inteiro ≥ 0, ou vazio pra sem limite" },
      { status: 400 },
    );
  }
  const { promoted } = await setEditionCapacity(id, c);
  return Response.json({ capacity: c, promoted: promoted.map((p) => p.username) });
}
