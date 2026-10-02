import type { Hackathon } from "@/lib/hackathons";

// spec 016 — arena ao vivo: fase da edição derivada puramente de
// (hackathon, now). Sem banco, sem relógio global — testável e SSR-determinístico.

/** janela "começando": falta ≤48h pro startsAt */
export const LIVE_WINDOW_MS = 48 * 3_600_000;
/** grace pós-evento: passou do fim efetivo + 7d a edição vira história ('archived') */
export const ARCHIVE_GRACE_MS = 7 * 24 * 3_600_000;

export type EditionPhase =
  | "open"
  | "closed-soon"
  | "live"
  | "ongoing"
  | "ended"
  | "archived";

export type CountdownTarget = {
  iso: string;
  kind: "deadline" | "start" | "end";
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
 *  archived   — passou do fim efetivo + 7d (grace pós-evento)
 *  ended      — encerrada (fim efetivo < now), ainda dentro da grace
 *  ongoing    — startsAt ≤ now e ainda não acabou: evento rolando
 *  live       — startsAt - now ≤ 48h e inscrição aberta ("começando")
 *  closed-soon — inscrição fechada (deadline < now), evento futuro
 *  open       — resto
 *
 * spec 030 — "fim efetivo" é a mesma fronteira de isOver (spec 027):
 * COALESCE(endsAt, registrationDeadline, startsAt) — deadline é proxy de
 * fim quando endsAt falta; data inválida (NaN) conta como "não encerrado".
 * Antes "now ≥ startsAt" virava arquivo, o que matava a página de evento
 * rolando — ongoing é a fase que faltava entre live e ended.
 */
export function editionPhase(h: Hackathon, now: Date): EditionPhase {
  const t = now.getTime();
  const starts = new Date(h.startsAt).getTime();
  if (Number.isNaN(starts)) return "open";

  const endRef = h.endsAt ?? h.registrationDeadline ?? h.startsAt;
  const end = new Date(endRef).getTime();
  if (!Number.isNaN(end) && t > end) {
    return t > end + ARCHIVE_GRACE_MS ? "archived" : "ended";
  }
  if (t >= starts) return "ongoing";

  const regOpen = registrationOpen(h, t);
  if (starts - t <= LIVE_WINDOW_MS && regOpen) return "live";
  if (!regOpen) return "closed-soon";
  return "open";
}

/**
 * Alvo do relógio:
 *  ongoing     — fim efetivo futuro: endsAt → "termina em"; sem ele,
 *                deadline futuro → "inscrições fecham em"; nenhum → null
 *                (fim inválido não inventa relógio)
 *  open/closed/live — deadline futuro anterior ao startsAt ganha
 *                ("inscrições fecham em"); senão startsAt ("começa em")
 *  ended/archived   — sem relógio no arquivo → null
 */
export function countdownTarget(h: Hackathon, now: Date): CountdownTarget | null {
  const phase = editionPhase(h, now);
  if (phase === "ended" || phase === "archived") return null;

  const t = now.getTime();
  const ends = h.endsAt ? new Date(h.endsAt).getTime() : NaN;
  const deadline = h.registrationDeadline
    ? new Date(h.registrationDeadline).getTime()
    : NaN;

  if (phase === "ongoing") {
    if (!Number.isNaN(ends) && ends > t) {
      return { iso: h.endsAt!, kind: "end" };
    }
    if (!Number.isNaN(deadline) && deadline > t) {
      return { iso: h.registrationDeadline as string, kind: "deadline" };
    }
    return null;
  }

  const starts = new Date(h.startsAt).getTime();
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
