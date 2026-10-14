import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { getEditionSponsor, SponsorError, type EditionSponsor } from "@/lib/editionSponsors";
import { canOptIn, contactPreview, getOptIn, revokeContact, shareContact, SHARED_FIELDS } from "@/lib/sponsorContacts";

// Opt-in de contato pro patrocinador (roadmap 037 #12). Logado sempre:
// 401 JSON deslogado; 404 marca fora da edição; 403 quem não é inscrito
// aprovado (POST). DELETE revoga na hora.
type Ctx = { params: Promise<{ id: string; sponsorId: string }> };

async function guard(
  id: string,
  sponsorId: string,
): Promise<{ response: Response } | { member: Member; sponsor: EditionSponsor }> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const sponsor = await getEditionSponsor(id, sponsorId);
  if (!sponsor) return { response: Response.json({ error: "patrocinador não encontrado nesta edição" }, { status: 404 }) };
  return { member, sponsor };
}

const fail = (e: unknown) =>
  Response.json({ error: (e as Error).message }, { status: e instanceof SponsorError ? e.status : 400 });

export async function GET(_req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await guard(id, sponsorId);
  if ("response" in g) return g.response;
  const [state, eligible, preview] = await Promise.all([
    getOptIn(id, sponsorId, g.member.id),
    canOptIn(id, g.member.id),
    contactPreview(id, g.member.id),
  ]);
  return Response.json({ sponsor: g.sponsor.name, fields: SHARED_FIELDS, eligible, preview, ...state });
}

export async function POST(_req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await guard(id, sponsorId);
  if ("response" in g) return g.response;
  try {
    return Response.json(await shareContact(id, sponsorId, g.member.id));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await guard(id, sponsorId);
  if ("response" in g) return g.response;
  try {
    return Response.json(await revokeContact(id, sponsorId, g.member.id));
  } catch (e) {
    return fail(e);
  }
}
