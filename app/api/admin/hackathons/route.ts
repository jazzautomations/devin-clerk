import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getMemberByClerkId } from "@/lib/members";

export async function POST(req: Request) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member || member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const required = ["id", "name", "organizer", "startsAt", "format"];
  if (!b || required.some((k) => typeof b[k] !== "string" || !b[k])) {
    return Response.json(
      { error: "Campos obrigatórios: id, name, organizer, startsAt, format" },
      { status: 400 },
    );
  }
  if (!["online", "presencial", "hibrido"].includes(b.format)) {
    return Response.json({ error: "format inválido" }, { status: 400 });
  }
  await db.prepare(
    `INSERT OR REPLACE INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline, tags, active, prize, source)
     VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location, @registrationUrl, @registrationDeadline, @tags, 1, @prize, @source)`,
  ).run({
    // evento de terceiro posto à mão vai pro radar como 'admin': o seed só
    // mantém no ar as edições da casa (source NULL) que ele conhece
    source: b.organizer.toLowerCase().includes("hack inova") ? null : "admin",
    id: b.id.trim(),
    name: b.name.trim(),
    organizer: b.organizer.trim(),
    startsAt: b.startsAt,
    endsAt: typeof b.endsAt === "string" && b.endsAt ? b.endsAt : null,
    format: b.format,
    location: typeof b.location === "string" && b.location ? b.location : null,
    registrationUrl:
      typeof b.registrationUrl === "string" && b.registrationUrl
        ? b.registrationUrl
        : `/h/${b.id.trim()}`,
    registrationDeadline:
      typeof b.registrationDeadline === "string" && b.registrationDeadline
        ? b.registrationDeadline
        : null,
    tags: JSON.stringify(Array.isArray(b.tags) ? b.tags : []),
    prize:
      typeof b.prize === "string" && b.prize.trim() ? b.prize.trim() : null,
  });
  return Response.json({ ok: true }, { status: 201 });
}
