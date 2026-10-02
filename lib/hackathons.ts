import db from "@/lib/db";

export type HackathonFormat = "online" | "presencial" | "hibrido";

export type Hackathon = {
  id: string;
  name: string;
  organizer: string;
  startsAt: string;
  endsAt: string | null;
  format: HackathonFormat;
  location: string | null;
  registrationUrl: string;
  registrationDeadline: string | null;
  tags: string[];
  active: boolean;
  partner: boolean;
};

type Row = Omit<Hackathon, "tags" | "active" | "partner"> & {
  tags: string;
  active: number;
};

function toHackathon(row: Row): Hackathon {
  return {
    ...row,
    tags: JSON.parse(row.tags),
    active: row.active === 1,
    partner: row.organizer.toLowerCase().includes("hack inova"),
  };
}

export function getUpcomingHackathons(now = new Date()): Hackathon[] {
  const rows = db
    .prepare("SELECT * FROM hackathons WHERE active = 1 AND startsAt > ?")
    .all(now.toISOString()) as Row[];
  return rows
    .map(toHackathon)
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
}

export function getHackathon(id: string): Hackathon | null {
  const row = db
    .prepare("SELECT * FROM hackathons WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? toHackathon(row) : null;
}

export function getTags(events?: Hackathon[]): string[] {
  const list = events ?? getUpcomingHackathons();
  return [...new Set(list.flatMap((h) => h.tags))].sort();
}

export function isRegistrationClosed(h: Hackathon, now = new Date()): boolean {
  return (
    h.registrationDeadline !== null &&
    new Date(h.registrationDeadline) < now
  );
}
