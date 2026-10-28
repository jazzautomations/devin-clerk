import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { isLeadInterest, LEAD_INTEREST_LABELS as LEAD_INTEREST_LABELS_LOCAL, type LeadInterest } from "@/lib/leadInterests";
import { isSupportKind, SUPPORT_KIND_LABELS, type SupportKind } from "@/lib/supportKinds";

// whitelist mora no módulo puro lib/leadInterests.ts (seguro pra client);
// re-export pra quem só importa a lib
export {
  LEAD_INTERESTS,
  LEAD_INTEREST_LABELS,
} from "@/lib/leadInterests";
export type { LeadInterest } from "@/lib/leadInterests";

// rate-limit-lite: mesmo (empresa, e-mail) dentro da janela é retry — não lead
// novo. Janela curta não bloqueia contato legítimo depois.
export const LEAD_DEDUPE_MS = 10 * 60 * 1000;

export const LEAD_MESSAGE_MAX = 1000;
/** mesmos limites do maxLength dos formulários; a API aplica de novo */
export const LEAD_COMPANY_MAX = 120;
export const LEAD_EMAIL_MAX = 200;

export type Lead = {
  id: number;
  company: string;
  email: string;
  interest: LeadInterest;
  message: string | null;
  createdAt: string;
  /** migration 028: lead "quero apoiar esta comunidade" */
  communityId: number | null;
  supportKind: SupportKind | null;
};

// sem ? & % / # nem aspas/<>: o e-mail vira `mailto:` no painel e não pode
// carregar parâmetro (bcc, subject) escondido
const EMAIL_RE = /^[^@\s?&%/#"'<>]+@[^@\s?&%/#"'<>]+\.[^@\s?&%/#"'<>]+$/;

export function isLeadEmail(email: string): boolean {
  return email.length <= LEAD_EMAIL_MAX && EMAIL_RE.test(email);
}

/** href de resposta só pra e-mail seguro; lead antigo fora do padrão fica sem link */
export function leadMailto(email: string): string | null {
  return isLeadEmail(email) ? `mailto:${email}` : null;
}

const opt = (v?: string | null) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export async function createLead(input: {
  company: string;
  email: string;
  interest: LeadInterest;
  message?: string | null;
  /** só com interest = 'comunidade' (e aí obrigatório) */
  communityId?: number | null;
  supportKind?: SupportKind | null;
}): Promise<{ lead: Lead; created: boolean }> {
  const company = typeof input.company === "string" ? input.company.trim() : "";
  if (!company) throw new Error("nome da empresa obrigatório");
  if (company.length > LEAD_COMPANY_MAX) throw new Error(`empresa: até ${LEAD_COMPANY_MAX} caracteres`);

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!isLeadEmail(email)) throw new Error("e-mail inválido");

  const message = opt(input.message);
  if (message && message.length > LEAD_MESSAGE_MAX) throw new Error(`mensagem: até ${LEAD_MESSAGE_MAX} caracteres`);

  if (!isLeadInterest(input.interest)) {
    throw new Error("interesse inválido");
  }

  const communityId = input.communityId ?? null;
  if ((input.interest === "comunidade") !== (communityId !== null)) {
    throw new Error("apoio a comunidade precisa dizer qual comunidade");
  }
  const supportKind = input.supportKind ?? null;
  if (supportKind !== null && !isSupportKind(supportKind)) {
    throw new Error("tipo de apoio inválido");
  }

  const normalized = email.toLowerCase();
  const cutoff = new Date(Date.now() - LEAD_DEDUPE_MS).toISOString();
  // a mesma empresa apoiando duas comunidades são dois leads
  const existing = await db
    .prepare(
      `SELECT * FROM leads
       WHERE lower(email) = lower(?) AND lower(company) = lower(?)
         AND communityId IS NOT DISTINCT FROM ?::int
         AND createdAt > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(normalized, company, communityId, cutoff) as Lead | undefined;
  if (existing) return { lead: existing, created: false };

  const res = await db
    .prepare(
      `INSERT INTO leads (company, email, interest, message, createdAt, communityId, supportKind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      company,
      normalized,
      input.interest,
      message,
      new Date().toISOString(),
      communityId,
      supportKind,
    );
  const lead = await db
    .prepare("SELECT * FROM leads WHERE id = ?")
    .get(Number(res.lastInsertRowid)) as Lead;
  if (lead.communityId !== null) await notifyCommunity(lead);
  else await notifyAdmins(lead);
  return { lead, created: true };
}

/** fila do /admin: leads da plataforma (os de comunidade vão pro painel dela) */
export async function listLeads(limit = 200): Promise<Lead[]> {
  return await db
    .prepare(
      "SELECT * FROM leads WHERE communityId IS NULL ORDER BY createdAt DESC, id DESC LIMIT ?",
    )
    .all(limit) as Lead[];
}

/** pedidos de apoio de uma comunidade, mais novos primeiro */
export async function listCommunityLeads(communityId: number, limit = 200): Promise<Lead[]> {
  return await db
    .prepare(
      "SELECT * FROM leads WHERE communityId = ? ORDER BY createdAt DESC, id DESC LIMIT ?",
    )
    .all(communityId, limit) as Lead[];
}

export async function countCommunityLeads(communityId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*)::int AS n FROM leads WHERE communityId = ?")
    .get<{ n: number }>(communityId);
  return Number(r?.n ?? 0);
}

/** spec 039 — lead novo avisa os admins in-app (fila em /admin) */
async function notifyAdmins(lead: Lead): Promise<void> {
  const admins = await db.prepare("SELECT id FROM members WHERE role = 'admin'").all<{ id: number }>();
  const what = lead.interest === "organizar" ? "quer organizar uma edição" : `lead de ${LEAD_INTEREST_LABELS_LOCAL[lead.interest]}`;
  await Promise.all(
    admins.map((a) =>
      notify(a.id, { type: "lead", text: `${lead.company} ${what}`, href: "/admin#leads" }),
    ),
  );
}

/**
 * migration 028 — pedido de apoio avisa dono e organizadores da comunidade.
 * Comunidade sem ninguém cuidando (a Hack Inova nasce sem dono) avisa os
 * admins, que administram ela.
 */
async function notifyCommunity(lead: Lead): Promise<void> {
  const c = await db
    .prepare("SELECT slug, name FROM communities WHERE id = ?")
    .get<{ slug: string; name: string }>(lead.communityId);
  if (!c) return;
  const managers = await db
    .prepare(
      `SELECT cm.memberId AS id FROM community_members cm JOIN members m ON m.id = cm.memberId
       WHERE cm.communityId = ? AND cm.role IN ('dono', 'organizador') AND m.clerkId NOT LIKE 'deleted:%'`,
    )
    .all<{ id: number }>(lead.communityId);
  const to = managers.length
    ? managers
    : await db.prepare("SELECT id FROM members WHERE role = 'admin'").all<{ id: number }>();
  const how = lead.supportKind ? ` (${SUPPORT_KIND_LABELS[lead.supportKind]})` : "";
  await Promise.all(
    to.map((m) =>
      notify(m.id, {
        type: "community_support",
        text: `${lead.company} quer apoiar a comunidade ${c.name}${how}.`,
        href: `/comunidade/${c.slug}/apoio#pedidos`,
      }),
    ),
  );
}
