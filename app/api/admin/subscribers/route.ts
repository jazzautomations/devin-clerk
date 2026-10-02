import { auth } from "@clerk/nextjs/server";
import { listSubscribers } from "@/lib/admin";
import { getMemberByClerkId } from "@/lib/members";

// escape mínimo RFC4180: aspas dobram e o campo vai entre aspas
const csvField = (s: string) =>
  /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

export async function GET(req: Request) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const subscribers = listSubscribers();
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const csv = [
      "email,createdAt",
      ...subscribers.map((s) => `${csvField(s.email)},${csvField(s.createdAt)}`),
    ].join("\n");
    return new Response(`${csv}\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subscribers.csv"',
      },
    });
  }
  return Response.json({ subscribers });
}
