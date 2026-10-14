import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import db from "@/lib/db";

// Dados do /api/health. O monitor externo (deploy/monitor/check.sh) lê o
// ?deep=1 e avisa quando o backup envelhece, a fila para, o disco enche ou
// um cron falha várias vezes seguidas.

/** release no ar: o deploy.sh grava VERSION (commit + data) na raiz do release */
export function readVersion(cwd = process.cwd()): string {
  try {
    return readFileSync(join(cwd, "VERSION"), "utf8").trim() || "dev";
  } catch {
    return process.env.HACKAHUB_VERSION || "dev";
  }
}

const hoursSince = (iso: string, now: number) => Math.round(((now - Date.parse(iso)) / 3_600_000) * 10) / 10;

/** carimbo ISO gravado por backup.sh / restore-drill.sh; null se não existir */
function stampAgeH(file: string, now: number): number | null {
  try {
    const iso = readFileSync(file, "utf8").trim();
    return Number.isNaN(Date.parse(iso)) ? null : hoursSince(iso, now);
  } catch {
    return null;
  }
}

/** contadores de falha seguida que o deploy/cron-call.sh mantém (logs/.fail-<rota>-<env>) */
export function readCronFails(logDir: string): Record<string, number> {
  const out: Record<string, number> = {};
  let files: string[] = [];
  try {
    files = readdirSync(logDir).filter((f) => f.startsWith(".fail-"));
  } catch {
    return out;
  }
  for (const f of files) {
    const n = Number(readFileSync(join(logDir, f), "utf8").trim());
    if (Number.isFinite(n) && n > 0) out[f.slice(".fail-".length)] = n;
  }
  return out;
}

export function diskPct(path = "/"): number | null {
  try {
    const s = statfsSync(path);
    const used = s.blocks - s.bfree;
    return Math.round((used / (used + s.bavail)) * 100);
  } catch {
    return null;
  }
}

// TEXT 'YYYY-MM-DD HH:MM:SS' em UTC (padrão do schema)
const utcMs = (t: string) => Date.parse(`${t.replace(" ", "T")}Z`);

async function oldestQueuedMin(table: "deliveries" | "ticket_emails", now: number): Promise<number | null> {
  const r = await db
    .prepare(`SELECT MIN(createdAt) AS oldest FROM ${table} WHERE status = 'queued'`)
    .get<{ oldest: string | null }>();
  return r?.oldest ? Math.max(0, Math.round((now - utcMs(r.oldest)) / 60_000)) : null;
}

/** Carimbo gravado pelo deploy/restore-drill.sh quando o drill de prod passa. */
export const DRILL_STAMP = "LAST_DRILL_OK-hackahub";

export type DeepHealth = {
  backupAgeH: number | null;
  drillAgeH: number | null;
  oldestQueuedDeliveryMin: number | null;
  oldestQueuedTicketMin: number | null;
  diskPct: number | null;
  cronFails: Record<string, number>;
};

export async function deepHealth(now = Date.now()): Promise<DeepHealth> {
  const backups = process.env.HACKAHUB_BACKUP_DIR ?? join(homedir(), "hackahub-backups");
  const logs = process.env.HACKAHUB_LOG_DIR ?? join(homedir(), "hackahub", "logs");
  const [oldestQueuedDeliveryMin, oldestQueuedTicketMin] = await Promise.all([
    oldestQueuedMin("deliveries", now),
    oldestQueuedMin("ticket_emails", now),
  ]);
  return {
    backupAgeH: stampAgeH(join(backups, "LAST_OK"), now),
    // só o drill de prod: o de stage (quarta) não pode renovar o carimbo
    // e esconder um drill de prod que falha todo domingo
    drillAgeH: stampAgeH(join(backups, DRILL_STAMP), now),
    oldestQueuedDeliveryMin,
    oldestQueuedTicketMin,
    diskPct: diskPct(),
    cronFails: readCronFails(logs),
  };
}
