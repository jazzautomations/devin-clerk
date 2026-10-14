import db from "@/lib/db";
import { isLeadInterest, type LeadInterest } from "@/lib/leadInterests";

// schema próprio (idempotente) — não edita lib/db.ts (pattern lib/deploys.ts)
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

export type Lead = {
  id: number;
  company: string;
  email: string;
  interest: LeadInterest;
  message: string | null;
  createdAt: string;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const opt = (v?: string | null) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export async function createLead(input: {
  company: string;
  email: string;
  interest: LeadInterest;
  message?: string | null;
}): Promise<{ lead: Lead; created: boolean }> {
  const company = typeof input.company === "string" ? input.company.trim() : "";
  if (!company) throw new Error("nome da empresa obrigatório");

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!EMAIL_RE.test(email)) throw new Error("e-mail inválido");

  if (!isLeadInterest(input.interest)) {
    throw new Error("interesse inválido");
  }

  const normalized = email.toLowerCase();
  const cutoff = new Date(Date.now() - LEAD_DEDUPE_MS).toISOString();
  const existing = await db
    .prepare(
      `SELECT * FROM leads
       WHERE lower(email) = lower(?) AND lower(company) = lower(?)
         AND createdAt > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(normalized, company, cutoff) as Lead | undefined;
  if (existing) return { lead: existing, created: false };

  const res = await db
    .prepare(
      `INSERT INTO leads (company, email, interest, message, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      company,
      normalized,
      input.interest,
      opt(input.message),
      new Date().toISOString(),
    );
  const lead = await db
    .prepare("SELECT * FROM leads WHERE id = ?")
    .get(Number(res.lastInsertRowid)) as Lead;
  return { lead, created: true };
}

export async function listLeads(limit = 200): Promise<Lead[]> {
  return await db
    .prepare(
      "SELECT * FROM leads ORDER BY createdAt DESC, id DESC LIMIT ?",
    )
    .all(limit) as Lead[];
}
