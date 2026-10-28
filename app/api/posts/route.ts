import { auth, currentUser } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getCommunityBySlug, getMembership } from "@/lib/communities";
import { getMemberByClerkId, getOrCreateMember } from "@/lib/members";
import { createPost, listPosts } from "@/lib/posts";
import { getRegistrationIds } from "@/lib/registrations";
import { limitOrNull } from "@/lib/ratelimit";
import { canManageEdition } from "@/lib/roles";

export async function GET(req?: Request) {
  // leitura pública — rede social é vitrine; postar exige conta.
  // spec 028: ?h=<id> recorta o mural da edição; sem ?h= agrega tudo
  // (posts de edição ficam no feed global, com chip)
  const { userId } = await auth();
  const me = userId ? await getMemberByClerkId(userId) : null;
  const h = req ? new URL(req.url).searchParams.get("h") : null;
  const c = req ? new URL(req.url).searchParams.get("c") : null;
  if (c) {
    const community = await getCommunityBySlug(c);
    if (!community || (community.hidden && me?.role !== "admin")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({
      posts: await listPosts(50, me?.id ?? null, { communityId: community.id }, { includeHidden: me?.role === "admin" }),
    });
  }
  if (h) {
    const edition = await getHackathon(h);
    if (!edition || !edition.active) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // edição de comunidade escondida: só a organização dela (igual /h/[id])
    if (edition.communityHidden && !(await canManageEdition(me, edition.id))) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({
      posts: await listPosts(50, me?.id ?? null, { hackathonId: edition.id }, { includeHidden: !!edition.communityHidden }),
    });
  }
  return Response.json({ posts: await listPosts(50, me?.id ?? null) });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const member = await getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  // spec 031 — flood de posts é freado por membro (20/h), não por IP
  const limited = limitOrNull(req, "posts", member.id);
  if (limited) {
    return limited;
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.body !== "string" || !body.body.trim()) {
    return Response.json({ error: "Post vazio" }, { status: 400 });
  }
  // spec 028 — escopo de edição: opcional; ausente/vazio/null = post global.
  // edição inexistente → 404; inativa → 400; postar no mural exige inscrição
  const rawH: unknown = body.hackathonId;
  let hackathonId: string | null = null;
  if (rawH !== undefined && rawH !== null && rawH !== "") {
    if (typeof rawH !== "string") {
      return Response.json({ error: "hackathonId inválido" }, { status: 400 });
    }
    const edition = await getHackathon(rawH);
    if (!edition) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (!edition.active) {
      return Response.json({ error: "edição inativa" }, { status: 400 });
    }
    if (!(await getRegistrationIds(member.id)).includes(edition.id)) {
      return Response.json(
        { error: "só quem tem inscrição aprovada nesta edição pode fazer isso" },
        { status: 403 },
      );
    }
    hackathonId = edition.id;
  }
  // mural da comunidade: só quem está nela posta (escondida = 404)
  let communityId: number | null = null;
  const rawC: unknown = body.communitySlug;
  if (rawC !== undefined && rawC !== null && rawC !== "") {
    if (typeof rawC !== "string" || hackathonId) {
      return Response.json({ error: "comunidade inválida" }, { status: 400 });
    }
    const community = await getCommunityBySlug(rawC);
    if (!community || (community.hidden && member.role !== "admin")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (!(await getMembership(community.id, member.id))) {
      return Response.json({ error: "Entre na comunidade pra postar no mural dela." }, { status: 403 });
    }
    communityId = community.id;
  }
  let post;
  try {
    post = await createPost(member.id, body.body, typeof body.link === "string" ? body.link : null, hackathonId, communityId);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Link inválido" }, { status: 400 });
  }
  // post não dá XP (plano 046): o que conta é presença e entrega
  return Response.json({ post }, { status: 201 });
}
