import { auth } from "@clerk/nextjs/server";
import { EDITION_ID_RE, isSafeLink } from "@/lib/admin";
import db from "@/lib/db";
import { EventTimeError, normalizeEventTime } from "@/lib/eventTime";
import { getMemberByClerkId } from "@/lib/members";

const FORMATS = ["online", "presencial", "hibrido"];
const bad = (error: string) => Response.json({ error }, { status: 400 });

// Cria uma edição (admin global). Nunca sobrescreve: endereço já usado é 409
// e a edição existente fica intacta. Dois casos, pelo organizador:
//   - edição da casa (sem organizador ou Hack Inova): source='painel', nasce
//     como rascunho (active = 0) e o organizador publica pela visão geral;
//   - evento de terceiro posto à mão no radar: source='admin' e já entra no
//     ar, como era no feat-r-radar (lib/radar.ts e o scraper tratam assim).
// O seed só mexe nas linhas dele (source='seed').
export async function POST(req: Request) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return bad("corpo da requisição inválido");
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const id = str("id");
  const name = str("name");
  if (!id || !name || !str("startsAt")) {
    return bad("Preencha o endereço, o nome e a data de início.");
  }
  if (!EDITION_ID_RE.test(id)) {
    return bad("Endereço inválido: use de 3 a 80 letras minúsculas, números ou hífen (ex.: hack-inova-sorocaba-2027).");
  }
  const format = str("format") || "presencial";
  if (!FORMATS.includes(format)) return bad("formato deve ser presencial, online ou híbrido");
  const registrationUrl = str("registrationUrl") || `/h/${id}`;
  if (!isSafeLink(registrationUrl)) {
    return bad("link de inscrição inválido: use um endereço http(s) ou um caminho do site");
  }

  let startsAt: string;
  let endsAt: string | null;
  let registrationDeadline: string | null;
  try {
    startsAt = normalizeEventTime(str("startsAt"));
    endsAt = str("endsAt") ? normalizeEventTime(str("endsAt")) : null;
    registrationDeadline = str("registrationDeadline") ? normalizeEventTime(str("registrationDeadline")) : null;
  } catch (e) {
    if (e instanceof EventTimeError) return bad(e.message);
    throw e;
  }

  const organizer = str("organizer") || "Hack Inova";
  const house = organizer.toLowerCase().includes("hack inova");

  const created = await db
    .prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, registrationDeadline,
          tags, active, source, prize)
       VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location, @registrationUrl,
               @registrationDeadline, @tags, @active, @source, @prize)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
    )
    .get<{ id: string }>({
      id,
      name,
      // o HackaHub é a casa da Hack Inova: sem organizador informado, é ela
      organizer,
      active: house ? 0 : 1,
      source: house ? "painel" : "admin",
      startsAt,
      endsAt,
      format,
      location: str("location") || null,
      registrationUrl,
      registrationDeadline,
      tags: JSON.stringify(Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === "string") : []),
      prize: str("prize") || null,
    });
  if (!created) {
    return Response.json(
      { error: `Já existe uma edição com o endereço "${id}". Escolha outro (ex.: ${id}-2).` },
      { status: 409 },
    );
  }
  return Response.json({ ok: true, id, radar: !house }, { status: 201 });
}
