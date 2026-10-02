import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { listDeploys, sweepDeploys } from "@/lib/deploys";

export async function GET() {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (member.role !== "admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  sweepDeploys();
  return Response.json({ deploys: listDeploys() });
}
