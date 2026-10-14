import db from "@/lib/db";
import { normalizeEventTime, sameEventTime } from "@/lib/eventTime";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
// garante o ALTER de requiresApproval (dona: lib/registrations) antes do
// UPDATE — spec 032
import "@/lib/registrations";

export type HackathonPatch = {
  name?: string;
  startsAt?: string;
  endsAt?: string | null;
  format?: string;
  location?: string | null;
  registrationUrl?: string;
  registrationDeadline?: string | null;
  prize?: string | null;
  tags?: string[];
  active?: boolean;
  requiresApproval?: boolean;
};

// update parcial: só os campos presentes no patch são tocados;
// null explícito limpa o campo (pra endsAt/location/deadline).
// Datas: normaliza na escrita (sem fuso = horário de Brasília, com o offset
// gravado) e, se o instante não mudou, não reescreve o texto — salvar o
// formulário sem mexer na data nunca altera a data. Formato desconhecido
// lança EventTimeError (a rota devolve 400).
export async function updateHackathon(
  id: string,
  patch: HackathonPatch,
): Promise<Hackathon | null> {
  const before = await getHackathon(id);
  if (!before) return null;
  for (const k of ["startsAt", "endsAt", "registrationDeadline"] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === null) {
      if (k === "startsAt") delete patch[k];
      continue;
    }
    if (sameEventTime(before[k], v)) delete patch[k];
    else patch[k] = normalizeEventTime(v);
  }

  const sets: string[] = [];
  const values: Record<string, unknown> = { id };

  if (patch.name !== undefined) {
    sets.push("name = @name");
    values.name = patch.name.trim();
  }
  if (patch.startsAt !== undefined) {
    sets.push("startsAt = @startsAt");
    values.startsAt = patch.startsAt;
  }
  if (patch.endsAt !== undefined) {
    sets.push("endsAt = @endsAt");
    values.endsAt = patch.endsAt;
  }
  if (patch.format !== undefined) {
    sets.push("format = @format");
    values.format = patch.format;
  }
  if (patch.location !== undefined) {
    sets.push("location = @location");
    values.location = patch.location;
  }
  if (patch.registrationUrl !== undefined) {
    sets.push("registrationUrl = @registrationUrl");
    values.registrationUrl = patch.registrationUrl;
  }
  if (patch.registrationDeadline !== undefined) {
    sets.push("registrationDeadline = @registrationDeadline");
    values.registrationDeadline = patch.registrationDeadline;
  }
  if (patch.prize !== undefined) {
    sets.push("prize = @prize");
    values.prize = patch.prize;
  }
  if (patch.tags !== undefined) {
    sets.push("tags = @tags");
    values.tags = JSON.stringify(patch.tags);
  }
  if (patch.active !== undefined) {
    sets.push("active = @active");
    values.active = patch.active ? 1 : 0;
  }
  if (patch.requiresApproval !== undefined) {
    sets.push("requiresApproval = @requiresApproval");
    values.requiresApproval = patch.requiresApproval ? 1 : 0;
  }

  if (sets.length > 0) {
    await db.prepare(`UPDATE hackathons SET ${sets.join(", ")} WHERE id = @id`).run(
      values,
    );
  }
  return getHackathon(id);
}

export async function listSubscribers(): Promise<{ email: string; createdAt: string }[]> {
  return await db
    .prepare("SELECT email, createdAt FROM subscribers ORDER BY id DESC")
    .all() as { email: string; createdAt: string }[];
}

// link de inscrição: http(s) ou caminho do próprio site. Nada de
// javascript:, data: ou "//outro.site" — o valor vira href na vitrine.
export function isSafeLink(v: string): boolean {
  return /^(https?:\/\/\S+|\/(?![/\\])\S*)$/i.test(v);
}

// endereço da edição (/h/<id>): minúsculas, números e hífen
export const EDITION_ID_RE = /^[a-z0-9-]{3,80}$/;
