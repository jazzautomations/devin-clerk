import { badgesPdf, isBadgeRole, listBadges } from "@/lib/crachas";
import { requireEditionManager } from "@/lib/editionAuth";
import { limitOrNull } from "@/lib/ratelimit";

// PDF dos crachás (folha Pimaco A4265): ?papel= filtra, ?guias=1 desenha o
// contorno das etiquetas pra testar o alinhamento em papel comum.
const HOUR = 3_600_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "crachas", g.member.id, { limit: 30, windowMs: HOUR });
  if (limited) return limited;
  const sp = new URL(req.url).searchParams;
  const papel = sp.get("papel");
  if (papel && papel !== "todos" && !isBadgeRole(papel)) {
    return Response.json({ error: "papel inválido" }, { status: 400 });
  }
  const role = papel && isBadgeRole(papel) ? papel : null;
  const badges = await listBadges(id, role);
  const pdf = await badgesPdf(badges, { hackathonName: g.hackathon.name, guides: sp.get("guias") === "1" });
  const file = `crachas-${id}${role ? `-${role}` : ""}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
      "X-Badge-Count": String(badges.length),
    },
  });
}
