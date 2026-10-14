// Datas da edição (startsAt, endsAt, registrationDeadline) — parser único.
//
// Formatos aceitos e o que cada um significa (a função SQL to_ts, migration
// 019, segue exatamente a mesma regra, e um teste confere as duas):
//  - "2026-11-14"                → 09:00 em Brasília (horário típico de abertura)
//  - "2026-11-14T09:00[:00]"     → horário de parede em Brasília (é o que o
//                                  <input type="datetime-local"> manda)
//  - "2026-11-14T09:00:00-03:00" → o instante exato (com Z ou offset)
//  - "2026-11-14 12:00:00"       → UTC (convenção do schema pros timestamps
//                                  do sistema: createdAt, rsvpDeadlineAt…)
// Qualquer outra coisa é inválida (null / erro na escrita).
//
// Sem banco e sem node:*: roda no navegador (EditEventForm) e no servidor.

export const EVENT_TZ = "America/Sao_Paulo";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function spParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}

/** diferença (ms) entre o relógio de Brasília e UTC naquele instante */
function spOffset(d: Date): number {
  const p = spParts(d);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(d.getTime() / 1000) * 1000;
}

/** instante de um horário de parede em Brasília (dia pode "transbordar": d=0, d=-3…) */
export function spWallTime(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const first = guess - spOffset(new Date(guess));
  return new Date(guess - spOffset(new Date(first)));
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const DB_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

const valid = (d: Date) => (Number.isNaN(d.getTime()) ? null : d);
// "2026-13-45" não pode virar uma data "transbordada" em silêncio
const inRange = (m: number, d: number, hh = 0, mm = 0, ss = 0) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && hh <= 23 && mm <= 59 && ss <= 59;

/** texto de data da edição → instante (null se vazio ou formato desconhecido) */
export function parseEventTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  const dateOnly = DATE_ONLY.exec(s);
  if (dateOnly) {
    if (!inRange(+dateOnly[2], +dateOnly[3])) return null;
    return valid(spWallTime(+dateOnly[1], +dateOnly[2], +dateOnly[3], 9, 0, 0));
  }
  const wall = WALL.exec(s);
  if (wall) {
    if (!inRange(+wall[2], +wall[3], +wall[4], +wall[5], wall[6] ? +wall[6] : 0)) return null;
    return valid(spWallTime(+wall[1], +wall[2], +wall[3], +wall[4], +wall[5], wall[6] ? +wall[6] : 0));
  }
  if (WITH_OFFSET.test(s)) {
    // "+0300" → "+03:00": o Date do JS só entende o offset com dois-pontos
    return valid(new Date(s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")));
  }
  if (DB_UTC.test(s)) return valid(new Date(`${s.replace(" ", "T")}Z`));
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** instante → "2026-11-14T09:00:00-03:00" (parede de Brasília + offset real) */
export function toEventIso(d: Date): string {
  const p = spParts(d);
  const off = Math.round(spOffset(d) / 60_000);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export class EventTimeError extends Error {}

/**
 * Normaliza o que chega do formulário/API antes de gravar. Horário sem fuso
 * vira horário de Brasília com o offset explícito; data pura e valor com
 * fuso ficam como vieram (já são inequívocos). Formato desconhecido lança.
 */
export function normalizeEventTime(v: string): string {
  const s = v.trim();
  const d = parseEventTime(s);
  if (!d) throw new EventTimeError("data inválida — use o seletor de data (horário de Brasília)");
  return WALL.test(s) ? toEventIso(d) : s;
}

/** valor salvo → valor de <input type="datetime-local"> no horário de Brasília */
export function toBrtInput(v: string | null | undefined): string {
  const d = parseEventTime(v);
  if (!d) return "";
  const p = spParts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
}

/** os dois textos apontam pro mesmo instante? (null só é igual a null) */
export function sameEventTime(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseEventTime(a);
  const y = parseEventTime(b);
  if (!x || !y) return !a && !b;
  return x.getTime() === y.getTime();
}
