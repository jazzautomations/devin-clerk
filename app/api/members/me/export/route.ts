import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { exportMemberData } from "@/lib/privacy";
import { limitOrNull } from "@/lib/ratelimit";

// LGPD art. 18 II/V — o titular baixa tudo que a plataforma guarda dele
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "privacy", member.id, { limit: 5, windowMs: 3_600_000 });
  if (limited) return limited;
  const data = await exportMemberData(member.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="hackahub-${member.username}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
