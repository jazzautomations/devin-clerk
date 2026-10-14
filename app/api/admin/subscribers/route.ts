import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { listSubscriberRows, subscribersCsv } from "@/lib/subscribers";

export async function GET(req: Request) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const subscribers = await listSubscriberRows();
  if (new URL(req.url).searchParams.get("format") === "csv") {
    // csvField de lib/registrationForm: escape RFC4180 + ' antes de = + - @
    return new Response(subscribersCsv(subscribers), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="subscribers.csv"',
      },
    });
  }
  return Response.json({ subscribers });
}
