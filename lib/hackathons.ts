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
  // display string da fonte/curadoria ("$138,000", "R$ 5 mil") — spec 024;
  // a UI repassa verbatim, nunca parseia
  prize: string | null;
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

function allActive(): Hackathon[] {
  const rows = db
    .prepare("SELECT * FROM hackathons WHERE active = 1")
    .all() as Row[];
  return rows.map(toHackathon);
}

export function getUpcomingHackathons(now = new Date()): Hackathon[] {
  return allActive()
    .filter((h) => new Date(h.startsAt) > now)
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
}

export function getPastHackathons(now = new Date()): Hackathon[] {
  return allActive()
    .filter((h) => new Date(h.startsAt) <= now)
    .sort(
      (a, b) =>
        new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    );
}

// busca textual do radar (?q=, spec 023) — substring case-insensitive sobre
// nome/local/tags. A lista já é materializada em JS (tags são JSON), então
// filtrar aqui é mais honesto que LIKE na coluna serializada
export function searchHackathons(q: string, now = new Date()): Hackathon[] {
  const list = getUpcomingHackathons(now);
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((h) =>
    [h.name, h.location ?? "", ...h.tags]
      .join("\n")
      .toLowerCase()
      .includes(needle),
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
