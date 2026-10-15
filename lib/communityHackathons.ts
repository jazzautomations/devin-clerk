import db from "@/lib/db";
import { cleanUrl, slugify, type Community } from "@/lib/communities";
import { EventTimeError, normalizeEventTime, parseEventTime } from "@/lib/eventTime";
import { grantEditionRole } from "@/lib/roles";

// Organizar sozinho: dono/organizador da comunidade abre o hackathon pelo
// painel da comunidade. Ele nasce rascunho (active = 0, source 'painel',
// communityId) e quem cria vira organizador da edição — daí em diante é o
// painel da edição (/admin/h/[id]) que já existe, e publicar depende só do
// checklist (getPublishBlockers), sem o admin global.

const FORMATS = ["presencial", "online", "hibrido"] as const;

export type NewHackathonInput = {
  name: string;
  startsAt: string;
  endsAt: string | null;
  format: (typeof FORMATS)[number];
  location: string | null;
  capacity: number | null;
  description: string | null;
  infoUrl: string | null;
};

export function parseNewHackathon(b: Record<string, unknown>): { value: NewHackathonInput } | { error: string } {
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const name = str("name").replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 90) return { error: "Dê um nome de 3 a 90 caracteres." };
  const format = (str("format") || "presencial") as NewHackathonInput["format"];
  if (!FORMATS.includes(format)) return { error: "formato deve ser presencial, online ou híbrido" };
  const location = str("location").slice(0, 160) || null;
  if (format !== "online" && !location) return { error: "Diga onde vai ser (ou marque online)." };
  let startsAt: string;
  let endsAt: string | null;
  try {
    if (!str("startsAt")) return { error: "Informe a data de início." };
    startsAt = normalizeEventTime(str("startsAt"));
    endsAt = str("endsAt") ? normalizeEventTime(str("endsAt")) : null;
  } catch (e) {
    if (e instanceof EventTimeError) return { error: e.message };
    throw e;
  }
  if (endsAt && parseEventTime(endsAt)!.getTime() < parseEventTime(startsAt)!.getTime()) {
    return { error: "O fim vem depois do início." };
  }
  let capacity: number | null = null;
  if (b.capacity !== undefined && b.capacity !== null && b.capacity !== "") {
    const n = Number(b.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: "Vagas: um número inteiro a partir de 1." };
    capacity = n;
  }
  const description = str("description") || null;
  if (description && description.length > 2000) return { error: "descrição: até 2000 caracteres" };
  const info = cleanUrl(b.infoUrl);
  if ("error" in info) return { error: `${info.error} (link do evento)` };
  return { value: { name, startsAt, endsAt, format, location, capacity, description, infoUrl: info.value } };
}

/** endereço da edição: nome + ano, com sufixo se já existir */
async function freeId(name: string, startsAt: string): Promise<string> {
  const year = (parseEventTime(startsAt) ?? new Date()).getUTCFullYear();
  let base = slugify(name).slice(0, 60).replace(/-+$/, "") || "hackathon";
  if (!base.endsWith(String(year))) base = `${base}-${year}`;
  if (base.length < 3) base = `hackathon-${year}`;
  for (let i = 1; i < 50; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    const taken = await db.prepare("SELECT 1 FROM hackathons WHERE id = ?").get(id);
    if (!taken) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createCommunityHackathon(
  c: Pick<Community, "id" | "name">,
  memberId: number,
  input: NewHackathonInput,
): Promise<{ id: string }> {
  return db.transaction(async () => {
    const id = await freeId(input.name, input.startsAt);
    await db
      .prepare(
        `INSERT INTO hackathons
           (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, source,
            capacity, description, infoUrl, communityId)
         VALUES (@id, @name, @organizer, @startsAt, @endsAt, @format, @location, @registrationUrl, '[]', 0, 'painel',
                 @capacity, @description, @infoUrl, @communityId)`,
      )
      .run({
        id,
        name: input.name,
        organizer: c.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        format: input.format,
        location: input.location,
        registrationUrl: `/h/${id}`,
        capacity: input.capacity,
        description: input.description,
        infoUrl: input.infoUrl,
        communityId: c.id,
      });
    await grantEditionRole(id, memberId, "organizador", memberId);
    return { id };
  })();
}
