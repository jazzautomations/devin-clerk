import db from "@/lib/db";
import { getHackathon, type Hackathon } from "@/lib/hackathons";

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
};

// update parcial: só os campos presentes no patch são tocados;
// null explícito limpa o campo (pra endsAt/location/deadline)
export function updateHackathon(
  id: string,
  patch: HackathonPatch,
): Hackathon | null {
  if (!getHackathon(id)) return null;

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

  if (sets.length > 0) {
    db.prepare(`UPDATE hackathons SET ${sets.join(", ")} WHERE id = @id`).run(
      values,
    );
  }
  return getHackathon(id);
}

export function listSubscribers(): { email: string; createdAt: string }[] {
  return db
    .prepare("SELECT email, createdAt FROM subscribers ORDER BY id DESC")
    .all() as { email: string; createdAt: string }[];
}
