import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  getSponsor,
  SPONSOR_TIERS,
  updateSponsor,
  type SponsorPatch,
  type SponsorTier,
} from "@/lib/sponsors";

const bad = (msg: string) => Response.json({ error: msg }, { status: 400 });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!getSponsor(id)) {
    return Response.json(
      { error: "Sponsor não encontrado" },
      { status: 404 },
    );
  }
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") {
    return bad("Body JSON obrigatório");
  }

  const patch: SponsorPatch = {};

  if ("name" in b) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      return bad("name inválido");
    }
    patch.name = b.name;
  }
  if ("tier" in b) {
    if (!SPONSOR_TIERS.includes(b.tier as SponsorTier)) {
      return bad("tier inválido");
    }
    patch.tier = b.tier;
  }
  // campos opcionais que aceitam null/vazio pra limpar
  for (const k of ["url", "contactEmail", "notes"] as const) {
    if (k in b) {
      if (b[k] !== null && typeof b[k] !== "string") {
        return bad(`${k} inválido`);
      }
      patch[k] = typeof b[k] === "string" && b[k] ? b[k] : null;
    }
  }
  if ("active" in b) {
    if (typeof b.active !== "boolean") {
      return bad("active deve ser booleano");
    }
    patch.active = b.active;
  }

  if (Object.keys(patch).length === 0) {
    return bad("Nenhum campo editável enviado");
  }

  try {
    const sponsor = updateSponsor(id, patch);
    return Response.json({ sponsor });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Erro");
  }
}
