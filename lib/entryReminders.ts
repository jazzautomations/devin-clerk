import db from "@/lib/db";
import { publishAnnouncement } from "@/lib/announcements";
import { formatBrt, getSubmissionSettings, isLocked, lockAt, parseDbTime } from "@/lib/entries";

// Lembretes da entrega (spec 034 §5 "Lembretes"): T-24h, T-3h e T-30min só
// pra time em RASCUNHO (nenhuma versão enviada), e o aviso de trava depois
// do prazo. Tudo sai pelos avisos existentes (audience 'time' → in-app,
// e-mail e zap com opt-in, pela fila de deliveries). Idempotente: cada
// lembrete é uma linha em submission_events com índice único parcial
// (teamId, kind) — o cron pode rodar a cada minuto sem duplicar.

export const REMINDER_WINDOWS = [
  { kind: "lembrete_24h", minutes: 24 * 60, label: "24 horas" },
  { kind: "lembrete_3h", minutes: 3 * 60, label: "3 horas" },
  { kind: "lembrete_30m", minutes: 30, label: "30 minutos" },
] as const;

export type ReminderKind = (typeof REMINDER_WINDOWS)[number]["kind"];

/**
 * Puro: qual lembrete vale agora? Só a faixa atual (24h vale de T-24h até
 * T-3h; 3h até T-30min; 30min até o prazo) — cron que perdeu uma faixa não
 * manda dois lembretes de uma vez.
 */
export function currentReminder(deadline: Date, now: Date): ReminderKind | null {
  const left = (deadline.getTime() - now.getTime()) / 60_000;
  if (left <= 0) return null;
  let pick: ReminderKind | null = null;
  for (const w of REMINDER_WINDOWS) if (left <= w.minutes) pick = w.kind;
  return pick;
}

/** grava o evento uma vez; true = acabou de nascer (pode mandar o aviso) */
async function once(hackathonId: string, teamId: number, kind: string): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO submission_events (hackathonId, teamId, kind) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(hackathonId, teamId, kind);
  return res.changes > 0;
}

export type ReminderResult = { editions: number; reminders: number; lockNotices: number };

export async function runEntryReminders(now = new Date()): Promise<ReminderResult> {
  const editions = await db
    .prepare(
      `SELECT id, name FROM hackathons
       WHERE active = 1 AND submissionDeadline IS NOT NULL
         AND to_ts(submissionDeadline) BETWEEN ?::timestamptz - interval '2 days' AND ?::timestamptz + interval '2 days'`,
    )
    .all<{ id: string; name: string }>(now.toISOString(), now.toISOString());
  const result: ReminderResult = { editions: editions.length, reminders: 0, lockNotices: 0 };

  for (const h of editions) {
    const settings = await getSubmissionSettings(h.id);
    const deadline = parseDbTime(settings?.submissionDeadline);
    if (!settings || !deadline) continue;
    const teams = await db
      .prepare(
        `SELECT t.id, t.reopenedUntil,
                (SELECT MAX(version) FROM project_submissions ps WHERE ps.teamId = t.id) AS version
         FROM teams t WHERE t.hackathonId = ? ORDER BY t.id`,
      )
      .all<{ id: number; reopenedUntil: string | null; version: number | null }>(h.id);

    const kind = currentReminder(deadline, now);
    if (kind) {
      const label = REMINDER_WINDOWS.find((w) => w.kind === kind)!.label;
      for (const t of teams.filter((x) => x.version === null)) {
        await db.transaction(async () => {
          if (!(await once(h.id, t.id, kind))) return;
          await publishAnnouncement(h.id, null, {
            system: true,
            audience: "time",
            teamId: t.id,
            title: `Faltam ${label} pra entrega`,
            body:
              `O projeto do teu time em ${h.name} ainda está em rascunho. ` +
              `Envia até ${formatBrt(settings.submissionDeadline)} (horário de Brasília) — ` +
              `sem envio o time fica como "não entregue" e não vai pro júri.`,
          });
          result.reminders++;
        })();
      }
    }

    const at = lockAt(settings);
    if (at && now > at) {
      for (const t of teams) {
        if (isLocked(settings, t.reopenedUntil, now) === false) continue;
        await db.transaction(async () => {
          if (!(await once(h.id, t.id, "travado"))) return;
          await publishAnnouncement(h.id, null, {
            system: true,
            audience: "time",
            teamId: t.id,
            title: t.version ? "Entrega travada — boa sorte no júri" : "Prazo de entrega encerrado",
            body: t.version
              ? `O prazo de ${h.name} fechou. A versão ${t.version} é a que o júri avalia. ` +
                `A seção "depois do hackathon" do projeto continua aberta.`
              : `O prazo de ${h.name} fechou sem envio do teu time — o projeto fica como "não entregue". ` +
                `Se foi problema técnico, fala com a organização.`,
          });
          result.lockNotices++;
        })();
      }
    }
  }
  return result;
}
