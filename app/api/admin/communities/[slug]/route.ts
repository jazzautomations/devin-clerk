import { getCommunityBySlug, setModeration } from "@/lib/communities";
import { currentMember } from "@/lib/session";

// moderação mínima do admin global: esconder (some das listas e da página
// pública; os hackathons dela saem do radar) e o selo de verificada
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const member = await currentMember();
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (member.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const { slug } = await params;
  const c = await getCommunityBySlug(slug);
  if (!c) return Response.json({ error: "Comunidade não encontrada" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { hidden?: unknown; verified?: unknown } | null;
  const patch: { hidden?: boolean; verified?: boolean } = {};
  for (const k of ["hidden", "verified"] as const) {
    if (b && k in b) {
      if (typeof b[k] !== "boolean") return Response.json({ error: `${k} deve ser booleano` }, { status: 400 });
      patch[k] = b[k] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) return Response.json({ error: "nada pra salvar" }, { status: 400 });
  return Response.json({ community: await setModeration(c.id, patch) });
}
