import { auth } from "@clerk/nextjs/server";
import { getOpenHackathons } from "@/lib/hackathons";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ hackathons: getOpenHackathons() });
}
