import type { Hackathon } from "@/lib/hackathons";

// spec 016 — arena ao vivo: fase da edição derivada puramente de
// (hackathon, now). Sem banco, sem relógio global — testável e SSR-determinístico.

/** janela "começando": falta ≤48h pro startsAt */
export const LIVE_WINDOW_MS = 48 * 3_600_000;
/** grace pós-evento: passou de endsAt + 7d a edição vira história ('archived') */
export const ARCHIVE_GRACE_MS = 7 * 24 * 3_600_000;

export type EditionPhase =
  | "open"
  | "closed-soon"
  | "live"
  | "ended"
  | "archived";

export type CountdownTarget = {
  iso: string;
  kind: "deadline" | "start";
};

export type CountdownParts = { d: number; h: number; m: number; s: number };

const ZERO: CountdownParts = { d: 0, h: 0, m: 0, s: 0 };

function registrationOpen(h: Hackathon, t: number): boolean {
  // coerente com isRegistrationClosed: fecha só quando deadline < now
  return h.registrationDeadline === null ||
    Number.isNaN(new Date(h.registrationDeadline).getTime())
    ? true
    : new Date(h.registrationDeadline).getTime() >= t;
}

/**
 * Fase da edição, em ordem (primeira que bate):
 *  archived   — now ≥ startsAt e now > (endsAt ?? startsAt) + 7d
 *  ended      — now ≥ startsAt (evento rolando/recém-terminado: modo arquivo)
 *  live       — startsAt - now ≤ 48h e inscrição aberta ("começando")
 *  closed-soon — inscrição fechada (deadline < now), evento futuro
 *  open       — resto
 */
export function editionPhase(h: Hackathon, now: Date): EditionPhase {
  const t = now.getTime();
  const starts = new Date(h.startsAt).getTime();
  if (Number.isNaN(starts)) return "open";

  if (t >= starts) {
    const endRef = h.endsAt ? new Date(h.endsAt).getTime() : starts;
    return t > endRef + ARCHIVE_GRACE_MS ? "archived" : "ended";
  }

  const regOpen = registrationOpen(h, t);
  if (starts - t <= LIVE_WINDOW_MS && regOpen) return "live";
  if (!regOpen) return "closed-soon";
  return "open";
}

/**
 * Alvo do relógio: deadline futuro anterior ao startsAt ganha
 * ("inscrições fecham em"); senão startsAt ("começa em").
 * Edição ended/archived não tem alvo → null.
 */
export function countdownTarget(h: Hackathon, now: Date): CountdownTarget | null {
  const phase = editionPhase(h, now);
  if (phase === "ended" || phase === "archived") return null;

  const t = now.getTime();
  const starts = new Date(h.startsAt).getTime();
  const deadline = h.registrationDeadline
    ? new Date(h.registrationDeadline).getTime()
    : NaN;

  if (!Number.isNaN(deadline) && deadline > t && deadline < starts) {
    return { iso: h.registrationDeadline as string, kind: "deadline" };
  }
  return { iso: h.startsAt, kind: "start" };
}

/** Decomposição não-negativa do tempo restante até targetIso (clamp em zero). */
export function countdownParts(targetIso: string, now: Date): CountdownParts {
  const target = new Date(targetIso).getTime();
  if (Number.isNaN(target)) return ZERO;
  const ms = Math.max(0, target - now.getTime());
  return {
    d: Math.floor(ms / 86_400_000),
    h: Math.floor(ms / 3_600_000) % 24,
    m: Math.floor(ms / 60_000) % 60,
    s: Math.floor(ms / 1_000) % 60,
  };
}
