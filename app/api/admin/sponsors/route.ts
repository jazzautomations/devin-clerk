import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  createSponsor,
  listSponsors,
  SPONSOR_TIERS,
  type SponsorTier,
} from "@/lib/sponsors";

export async function GET() {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ sponsors: listSponsors() });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  if (!b || typeof b.name !== "string" || !b.name.trim()) {
    return Response.json({ error: "name obrigatório" }, { status: 400 });
  }
  if (
    b.tier !== undefined &&
    !SPONSOR_TIERS.includes(b.tier as SponsorTier)
  ) {
    return Response.json({ error: "tier inválido" }, { status: 400 });
  }
  for (const k of ["url", "contactEmail", "notes"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") {
      return Response.json({ error: `${k} inválido` }, { status: 400 });
    }
  }
  try {
    const sponsor = createSponsor({
      name: b.name,
      url: typeof b.url === "string" ? b.url : null,
      tier: b.tier as SponsorTier | undefined,
      contactEmail:
        typeof b.contactEmail === "string" ? b.contactEmail : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    });
    return Response.json({ sponsor }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 },
    );
  }
}
