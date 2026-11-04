import db from "@/lib/db";

// Semanas construindo (spec 046, onda 3, migration 044).
//
// Contador CUMPLATIVO: quantas semanas a pessoa (ou o time) construiu alguma
// coisa — atualização no diário do projeto ou commit em repositório de
// projeto dela. Nunca zera: semana vazia não apaga o que já foi feito (o
// plano 046 proíbe "contador de sequência que zera").
//
// `sequencia` é a sequência de agora, com folga: até 2 semanas vazias por mês
// corrido são perdoadas. Quem tira férias ou entrega outra coisa não perde o
// número; quem some por dois meses vê a sequência parar — e o total fica.
//
// Semana = ISO, no horário de Brasília (segunda 00:00 BRT começa a semana),
// a mesma convenção de lib/digest.ts. Aqui a semana é só um número
// (segunda-feira desde a epoch) pra contar distância sem lidar com fuso.

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** semanas vazias perdoadas por mês corrido (plano 046 / spec 043) */
export const FORGIVE_PER_MONTH = 2;

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hourCycle: "h23",
});

/** a data de parede em Brasília, como UTC (só pra contar dias) */
function brtWallDate(d: Date): Date {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}

/**
 * A segunda-feira da semana ISO de `d`, no horário de Brasília, como UTC
 * midnight. É a chave da semana: mesma segunda = mesma semana.
 */
export function weekStart(d: Date): Date {
  const wall = brtWallDate(d);
  const dow = wall.getUTCDay() || 7; // segunda = 1, domingo = 7
  return new Date(wall.getTime() - (dow - 1) * DAY);
}

/** número da semana desde a epoch (segunda 1970-01-05 = 0); só pra distância */
export function weekIndex(d: Date): number {
  return Math.round(weekStart(d).getTime() / WEEK);
}

/** "2026-W44" — mesmo formato do resumo semanal (lib/digest.ts) */
export function weekKey(d: Date): string {
  const thursday = new Date(weekStart(d).getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** o mês (parede de Brasília) da semana `index`: a folga é contada por mês */
function monthOfWeek(index: number): string {
  const monday = new Date(index * WEEK);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, o formato do schema) ou ISO → Date */
export function parseDbDate(v: string): Date | null {
  const s = v.trim();
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** timestamps (data de atualização, data de commit) → semanas distintas, em ordem */
export function weeksFromDates(dates: (string | null | undefined)[]): number[] {
  const set = new Set<number>();
  for (const raw of dates) {
    if (!raw) continue;
    const d = parseDbDate(raw);
    if (d) set.add(weekIndex(d));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Puro e testável: `total` = semanas com atividade (cumulativo, nunca zera) e
 * `sequencia` = semanas seguidas até a semana de agora, perdoando até
 * FORGIVE_PER_MONTH semanas vazias por mês. A semana em curso pode estar
 * vazia: ela ainda não acabou.
 */
export function summarizeWeeks(weeks: number[], now: Date = new Date()): { total: number; sequencia: number } {
  const distinct = [...new Set(weeks)].sort((a, b) => a - b);
  if (distinct.length === 0) return { total: 0, sequencia: 0 };
  const current = weekIndex(now);
  const oldest = distinct[0];
  const has = new Set(distinct);
  const used = new Map<string, number>();
  let sequencia = 0;
  for (let w = current; w >= oldest; w--) {
    if (has.has(w)) {
      sequencia++;
      continue;
    }
    const month = monthOfWeek(w);
    const spent = used.get(month) ?? 0;
    if (spent >= FORGIVE_PER_MONTH) break;
    used.set(month, spent + 1);
  }
  return { total: distinct.length, sequencia };
}

/** as datas de commit do dossiê (JSON de lib/dossier.ts) */
function commitDates(json: string | null): string[] {
  try {
    const arr = JSON.parse(json ?? "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((c) => (c && typeof c === "object" ? (c as { date?: unknown }).date : null)).filter((d): d is string => typeof d === "string");
  } catch {
    return [];
  }
}

/** semanas que a PESSOA construiu: diário de projeto dela + commits de time dela */
export async function buildWeeks(memberId: number, now: Date = new Date()): Promise<{ total: number; sequencia: number }> {
  const [updates, dossiers] = await Promise.all([
    db
      .prepare("SELECT createdAt FROM posts WHERE memberId = ? AND teamId IS NOT NULL ORDER BY createdAt")
      .all<{ createdAt: string }>(memberId),
    db
      .prepare(
        `SELECT d.commits FROM project_dossiers d
         JOIN team_members tm ON tm.teamId = d.teamId
         JOIN members m ON m.username = tm.username
         WHERE m.id = ?`,
      )
      .all<{ commits: string | null }>(memberId),
  ]);
  const dates = [
    ...updates.map((r) => r.createdAt),
    ...dossiers.flatMap((d) => commitDates(d.commits)),
  ];
  return summarizeWeeks(weeksFromDates(dates), now);
}

/** semanas que o TIME construiu: diário do projeto + commits do repositório dele */
export async function buildWeeksTeam(teamId: number, now: Date = new Date()): Promise<{ total: number; sequencia: number }> {
  const [updates, dossier] = await Promise.all([
    db
      .prepare("SELECT createdAt FROM posts WHERE teamId = ? ORDER BY createdAt")
      .all<{ createdAt: string }>(teamId),
    db.prepare("SELECT commits FROM project_dossiers WHERE teamId = ?").get<{ commits: string | null }>(teamId),
  ]);
  const dates = [...updates.map((r) => r.createdAt), ...commitDates(dossier?.commits ?? null)];
  return summarizeWeeks(weeksFromDates(dates), now);
}

/**
 * Texto da página: "o time constrói há N semanas". Aparece a partir de 2
 * (uma semana só é o próprio evento). Puro.
 */
export function buildWeeksLabel(weeks: { total: number }): string | null {
  if (weeks.total < 2) return null;
  return `o time constrói há ${weeks.total} semanas`;
}
