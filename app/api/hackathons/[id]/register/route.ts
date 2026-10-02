import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { register, unregister } from "@/lib/registrations";
import { XP } from "@/lib/game";
import { awardXp, checkBadges, mintCard } from "@/lib/xp";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const hackathon = getHackathon(id);
  if (!hackathon || !hackathon.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  register(member.id, hackathon.id);
  awardXp(member.id, XP.register);
  const cardSerial = mintCard(member.id, hackathon.id);
  const newBadges = checkBadges(member.id);
  return Response.json({
    registered: true,
    hackathonId: hackathon.id,
    xp: `+${XP.register}`,
    cardSerial,
    newBadges: newBadges.map((b) => b.id),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  unregister(member.id, id);
  return Response.json({ registered: false, hackathonId: id });
}
