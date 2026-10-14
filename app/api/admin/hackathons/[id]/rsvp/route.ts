import { requireEditionManager } from "@/lib/editionAuth";
import {
  getRsvpConfig,
  getRsvpFunnel,
  listRsvpRows,
  rsvpCsv,
  RsvpConfigError,
  setRsvpConfig,
  validateRsvpConfig,
  type RsvpConfig,
} from "@/lib/rsvp";

// Aba presença (migration 012) — configuração do RSVP, funil e export.
// Só organizador da edição / admin global.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const rows = await listRsvpRows(id);
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response(rsvpCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="presenca-${id}.csv"`,
      },
    });
  }
  const [config, funnel] = await Promise.all([getRsvpConfig(id), getRsvpFunnel(id)]);
  return Response.json({ config, funnel, rows });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const body = await req.json().catch(() => null);
  let cfg: RsvpConfig;
  try {
    cfg = validateRsvpConfig(body);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const acceptOverCapacity = (body as { acceptOverCapacity?: unknown } | null)?.acceptOverCapacity === true;
  try {
    const { promoted } = await setRsvpConfig(id, cfg, { acceptOverCapacity });
    return Response.json({ config: cfg, promoted });
  } catch (e) {
    if (e instanceof RsvpConfigError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
