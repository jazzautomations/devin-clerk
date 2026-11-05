import { createHash } from "node:crypto";
import db from "@/lib/db";
import { generateUsername } from "@/lib/members";
import { completeRegistration } from "@/lib/registrations";
import { queueTicketEmail } from "@/lib/ticketEmail";

// Import de convidados de fora (Luma, planilha, formulário): a pessoa chega
// ao HackaHub sem conta. Cada e-mail vira um membro "importado" — clerkId
// `import:<hash>`, sem login possível — e uma inscrição aprovada com o
// ingresso (QR) na fila de e-mail. Quando a pessoa entrar com o mesmo
// e-mail, getOrCreateMember adota esse membro (lib/members.ts) e nada se
// perde: inscrição, cartão, selos e histórico ficam.
//
// Idempotente: o clerkId sai do hash do e-mail e a inscrição é única por
// (memberId, hackathonId) — reimportar a mesma planilha não duplica nada.

export type ImportGuest = { email: string; name?: string | null };

export type ImportResult = {
  imported: {
    email: string;
    memberId: number;
    username: string;
    registrationId: number;
    memberCreated: boolean;
  }[];
  skipped: { email: string; reason: string }[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** clerkId determinístico do convidado — a chave da idempotência */
export function stubClerkId(email: string): string {
  return `import:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24)}`;
}

export function normalizeGuestEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

function splitName(name: string | null | undefined): { first: string | null; last: string | null } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : null };
}

/**
 * Importa convidados como inscritos aprovados da edição. `dryRun` só diz o
 * que entraria. Cada importado recebe o e-mail do ingresso (fila das
 * entregas, cron a cada 2 min) e pode ser checado na porta sem login.
 */
export async function importGuests(
  hackathonId: string,
  guests: ImportGuest[],
  opts: { dryRun?: boolean } = {},
): Promise<ImportResult> {
  const h = await db
    .prepare("SELECT id FROM hackathons WHERE id = ?")
    .get<{ id: string }>(hackathonId);
  if (!h) throw new Error("edição não encontrada");

  const out: ImportResult = { imported: [], skipped: [] };
  const seen = new Set<string>();

  for (const guest of guests) {
    const email = normalizeGuestEmail(guest.email);
    if (!email) {
      out.skipped.push({ email: String(guest.email ?? ""), reason: "e-mail inválido" });
      continue;
    }
    if (seen.has(email)) {
      out.skipped.push({ email, reason: "repetido na planilha" });
      continue;
    }
    seen.add(email);

    const existing = await db
      .prepare(
        `SELECT id, username, "clerkId" FROM members WHERE LOWER(email) = ? ORDER BY id LIMIT 1`,
      )
      .get<{ id: number; username: string; clerkId: string }>(email);

    if (opts.dryRun) {
      out.imported.push({
        email,
        memberId: existing?.id ?? 0,
        username: existing?.username ?? "",
        registrationId: 0,
        memberCreated: !existing,
      });
      continue;
    }

    const result = await db.transaction(async () => {
      let memberId: number;
      let username: string;
      let memberCreated = false;

      if (existing) {
        memberId = existing.id;
        username = existing.username;
      } else {
        const { first, last } = splitName(guest.name);
        username = await generateUsername(first, last, email);
        const created = await db
          .prepare(
            `INSERT INTO members ("clerkId", username, name, email, role, "avatarKind")
             VALUES (?, ?, ?, ?, 'member', 'bicho')
             ON CONFLICT ("clerkId") DO NOTHING
             RETURNING id`,
          )
          .get<{ id: number }>(stubClerkId(email), username, guest.name?.trim() || null, email);
        if (created) {
          memberId = created.id;
          memberCreated = true;
        } else {
          // corrida com outro import: pega o que já existe
          const row = await db
            .prepare(`SELECT id, username FROM members WHERE "clerkId" = ?`)
            .get<{ id: number; username: string }>(stubClerkId(email));
          memberId = row!.id;
          username = row!.username;
        }
      }

      const reg = await db
        .prepare(
          `INSERT INTO registrations ("memberId", "hackathonId", status, "reviewedAt", "publicListing")
           VALUES (?, ?, 'approved', datetime('now'), 0)
           ON CONFLICT ("memberId", "hackathonId") DO NOTHING
           RETURNING id`,
        )
        .get<{ id: number }>(memberId, hackathonId);

      let registrationId: number;
      if (reg) {
        registrationId = reg.id;
        // mesma porta de qualquer aprovação: cartão, selos e ingresso
        await completeRegistration(memberId, hackathonId);
        await queueTicketEmail(memberId, hackathonId);
      } else {
        const row = await db
          .prepare(`SELECT id FROM registrations WHERE "memberId" = ? AND "hackathonId" = ?`)
          .get<{ id: number }>(memberId, hackathonId);
        registrationId = row!.id;
      }

      return { memberId, username, registrationId, memberCreated };
    })();

    out.imported.push({ email, ...result });
  }

  return out;
}
