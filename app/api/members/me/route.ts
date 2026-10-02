import { auth } from "@clerk/nextjs/server";
import { updateMemberProfile } from "@/lib/members";

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  updateMemberProfile(userId, {
    name: typeof body.name === "string" ? body.name : undefined,
    bio: typeof body.bio === "string" ? body.bio : undefined,
    skills: Array.isArray(body.skills)
      ? body.skills.filter((s: unknown) => typeof s === "string")
      : undefined,
    github: typeof body.github === "string" ? body.github : undefined,
    linkedin: typeof body.linkedin === "string" ? body.linkedin : undefined,
    twitter: typeof body.twitter === "string" ? body.twitter : undefined,
    website: typeof body.website === "string" ? body.website : undefined,
    headline: typeof body.headline === "string" ? body.headline : undefined,
    persona: typeof body.persona === "string" ? body.persona : undefined,
  });
  return Response.json({ ok: true });
}
