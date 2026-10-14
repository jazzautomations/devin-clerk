import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import db from "@/lib/db";
import { isTicketTokenShape, ticketSecret, ticketToken } from "@/lib/checkins";
import {
  checkinWindow,
  type OfflinePack,
  type PackEntry,
  type PackStatus,
  type SyncItemResult,
} from "@/lib/offlineCheckin";

// Check-in offline — lado do servidor (roadmap 037 Onda 1 #5, 035 #6).
//
// Pacote: por inscrição da edição, SHA-256 do token do QR + nome + username
// + status + check-in já feito. O token em si não vai (quem rouba o pacote
// do celular do staff não consegue gerar QR válido: SHA-256 não volta), o
// segredo HMAC não vai, e-mail não vai. A assinatura (HMAC com uma chave
// DERIVADA do segredo do ingresso, nunca ele) prova que o pacote saiu
// daqui — verifyOfflinePack confere.
//
// Sync: o aparelho manda a fila {token|registrationId, at}. O servidor não
// confia no pacote — revalida o token pelo HMAC, o status atual, e limita o
// horário à janela da edição (e a "agora"). Mesmo check-in duas vezes não
// duplica (PK em registrationId); dois aparelhos com a mesma pessoa → fica o
// PRIMEIRO horário.

export const SYNC_MAX_ITEMS = 500;

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function packKey(): Buffer {
  return createHmac("sha256", ticketSecret()).update("hackahub-offline-pack-v1").digest();
}

function packSignature(p: Omit<OfflinePack, "sig">): string {
  const canonical = JSON.stringify([p.v, p.hackathonId, p.issuedAt, p.window, p.entries]);
  return createHmac("sha256", packKey()).update(canonical).digest("base64url");
}

export function verifyOfflinePack(p: OfflinePack): boolean {
  const { sig, ...rest } = p;
  const expected = Buffer.from(packSignature(rest));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type EditionDates = { startsAt: string; endsAt: string | null };

// a janela mora em lib/offlineCheckin (sem banco): o check-in online
// (lib/checkins, walk-in) usa a mesma regra
export { checkinWindow };

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** horário do aparelho → dentro da janela e nunca no futuro do servidor */
export function clampCheckinAt(at: unknown, window: { start: Date; end: Date }, now: Date): Date {
  return clampWithFlag(at, window, now).at;
}

/** idem, dizendo se o horário precisou ser ajustado (relógio errado, lixo) */
export function clampWithFlag(
  at: unknown,
  window: { start: Date; end: Date },
  now: Date,
): { at: Date; clamped: boolean } {
  const parsed = typeof at === "string" ? new Date(at) : new Date(NaN);
  const raw = Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  let t = raw ?? now.getTime();
  t = Math.max(t, window.start.getTime());
  t = Math.min(t, window.end.getTime(), now.getTime());
  // folga de 1s: o mesmo instante serializado e lido de novo não é "ajuste"
  return { at: new Date(t), clamped: raw === null || Math.abs(raw - t) > 1000 };
}

type RegRow = { id: number; status: PackStatus; username: string; name: string | null; at: string | null };

async function editionRegs(hackathonId: string): Promise<RegRow[]> {
  return db
    .prepare(
      `SELECT r.id, r.status, m.username, m.name, c.at
       FROM registrations r
       JOIN members m ON m.id = r.memberId
       LEFT JOIN checkins c ON c.registrationId = r.id
       WHERE r.hackathonId = ?
       ORDER BY r.id`,
    )
    .all<RegRow>(hackathonId);
}

export async function buildOfflinePack(
  hackathon: { id: string } & EditionDates,
  now: Date = new Date(),
): Promise<OfflinePack> {
  const regs = await editionRegs(hackathon.id);
  const w = checkinWindow(hackathon);
  const entries: PackEntry[] = regs.map((r) => ({
    h: tokenHash(ticketToken(r.id)),
    rid: r.id,
    name: r.name ?? `@${r.username}`,
    username: r.username,
    status: r.status,
    at: r.at,
  }));
  const body = {
    v: 1 as const,
    hackathonId: hackathon.id,
    issuedAt: now.toISOString(),
    window: { start: w.start.toISOString(), end: w.end.toISOString() },
    entries,
  };
  return { ...body, sig: packSignature(body) };
}

export type SyncItem = { token?: unknown; registrationId?: unknown; at?: unknown };

export function parseSyncItems(raw: unknown): SyncItem[] | null {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > SYNC_MAX_ITEMS) return null;
  if (!items.every((i) => i && typeof i === "object")) return null;
  return items as SyncItem[];
}

/**
 * Sobe a fila do aparelho. Uma resposta por item, na mesma ordem.
 * outcome: created (entrou agora) · earlier (já havia check-in, mas este é
 * mais cedo e virou o oficial) · already (já havia um igual ou mais cedo).
 */
export async function syncCheckins(
  hackathon: { id: string } & EditionDates,
  items: SyncItem[],
  byMemberId: number | null,
  now: Date = new Date(),
): Promise<SyncItemResult[]> {
  const regs = await editionRegs(hackathon.id);
  const byHash = new Map(regs.map((r) => [tokenHash(ticketToken(r.id)), r]));
  const byId = new Map(regs.map((r) => [r.id, r]));
  const w = checkinWindow(hackathon);
  const out: SyncItemResult[] = [];

  for (const item of items) {
    let reg: RegRow | undefined;
    if (typeof item.token === "string") {
      const t = item.token.trim();
      if (!isTicketTokenShape(t)) {
        out.push({ rid: null, ok: false, reason: "invalid" });
        continue;
      }
      reg = byHash.get(tokenHash(t));
    } else if (typeof item.registrationId === "number" && Number.isSafeInteger(item.registrationId)) {
      reg = byId.get(item.registrationId);
    } else {
      out.push({ rid: null, ok: false, reason: "invalid" });
      continue;
    }
    if (!reg) {
      out.push({
        rid: typeof item.registrationId === "number" ? item.registrationId : null,
        ok: false,
        reason: "not_found",
      });
      continue;
    }
    if (reg.status !== "approved") {
      out.push({ rid: reg.id, ok: false, reason: reg.status });
      continue;
    }
    const adj = clampWithFlag(item.at, w, now);
    const at = sqlTime(adj.at);
    const row = await db
      .prepare(
        `INSERT INTO checkins (registrationId, at, byMemberId, via, syncedAt)
         VALUES (@rid, @at, @by, 'offline', @synced)
         ON CONFLICT ("registrationId") DO UPDATE SET
           at = excluded.at, byMemberId = excluded.byMemberId,
           via = excluded.via, syncedAt = excluded.syncedAt
         WHERE to_ts(excluded.at) < to_ts(checkins.at)
         RETURNING at, (xmax = 0) AS inserted`,
      )
      .get<{ at: string; inserted: boolean }>({ rid: reg.id, at, by: byMemberId, synced: sqlTime(now) });
    if (row) {
      out.push({
        rid: reg.id,
        ok: true,
        outcome: row.inserted ? "created" : "earlier",
        at: row.at,
        ...(adj.clamped ? { clamped: true } : {}),
      });
    } else {
      const cur = await db
        .prepare("SELECT at FROM checkins WHERE registrationId = ?")
        .get<{ at: string }>(reg.id);
      out.push({ rid: reg.id, ok: true, outcome: "already", at: cur!.at });
    }
  }
  return out;
}
