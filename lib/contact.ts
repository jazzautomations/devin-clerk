import db from "@/lib/db";
import { normalizeBrPhone } from "@/lib/notify/phone";

// FR-010 — telefone + opt-in de WhatsApp do membro, separados do e-mail.
// Opt-in só vale com telefone validado; tirar o telefone tira o opt-in.

export type ContactPrefs = {
  phone: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: string | null;
  emailBouncedAt: string | null;
};

export async function getContactPrefs(memberId: number): Promise<ContactPrefs> {
  const row = await db
    .prepare(
      "SELECT phone, whatsappOptIn, whatsappOptInAt, emailBouncedAt FROM members WHERE id = ?",
    )
    .get<{ phone: string | null; whatsappOptIn: number; whatsappOptInAt: string | null; emailBouncedAt: string | null }>(memberId);
  return {
    phone: row?.phone ?? null,
    whatsappOptIn: row?.whatsappOptIn === 1,
    whatsappOptInAt: row?.whatsappOptInAt ?? null,
    emailBouncedAt: row?.emailBouncedAt ?? null,
  };
}

export type ContactPatch = { phone?: string | null; whatsappOptIn?: boolean };

/** valida o pedaço de contato do PATCH /api/members/me (campo ausente = preserva) */
export function parseContactPatch(body: Record<string, unknown>): ContactPatch | { error: string } {
  const patch: ContactPatch = {};
  if ("phone" in body) {
    if (body.phone === null || body.phone === "") patch.phone = null;
    else {
      const phone = normalizeBrPhone(body.phone);
      if (!phone) return { error: "telefone inválido — use DDD + número, ex. (11) 99999-9999" };
      patch.phone = phone;
    }
  }
  if ("whatsappOptIn" in body) {
    if (typeof body.whatsappOptIn !== "boolean") return { error: "whatsappOptIn inválido" };
    patch.whatsappOptIn = body.whatsappOptIn;
  }
  return patch;
}

export async function applyContactPatch(
  memberId: number,
  patch: ContactPatch,
): Promise<{ ok: true } | { error: string }> {
  if (patch.phone === undefined && patch.whatsappOptIn === undefined) return { ok: true };
  const current = await getContactPrefs(memberId);
  const phone = patch.phone !== undefined ? patch.phone : current.phone;
  let optIn = patch.whatsappOptIn ?? current.whatsappOptIn;
  if (patch.whatsappOptIn === true && !phone) {
    return { error: "pra receber pelo WhatsApp, informe um telefone válido" };
  }
  if (!phone) optIn = false;
  const optInAt = optIn ? (current.whatsappOptIn ? current.whatsappOptInAt : "now") : null;
  await db
    .prepare(
      `UPDATE members SET phone = @phone, whatsappOptIn = @optIn,
         whatsappOptInAt = CASE WHEN @optInAt::text = 'now' THEN sqlite_now() ELSE @optInAt::text END
       WHERE id = @id`,
    )
    .run({ id: memberId, phone, optIn: optIn ? 1 : 0, optInAt });
  return { ok: true };
}

/** bounce/reclamação vinda do provedor: marca o contato, o worker para de insistir */
export async function markEmailBounced(email: string): Promise<number> {
  const r = await db
    .prepare(
      "UPDATE members SET emailBouncedAt = sqlite_now() WHERE lower(email) = ? AND emailBouncedAt IS NULL",
    )
    .run(email.trim().toLowerCase());
  return r.changes;
}
