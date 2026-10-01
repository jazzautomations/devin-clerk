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
};

import { hackathons } from "@/data/hackathons";

export function getUpcomingHackathons(now = new Date()): Hackathon[] {
  return hackathons
    .filter((h) => h.active && new Date(h.startsAt) > now)
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
}

export function getTags(events: Hackathon[] = hackathons): string[] {
  return [...new Set(events.flatMap((h) => h.tags))].sort();
}

export function isRegistrationClosed(h: Hackathon, now = new Date()): boolean {
  return (
    h.registrationDeadline !== null &&
    new Date(h.registrationDeadline) < now
  );
}
