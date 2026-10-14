import { randomBytes } from "node:crypto";
import db from "@/lib/db";
import { emailDriver } from "@/lib/notify/email";
import type { DriverEnv, SendOutcome } from "@/lib/notify/types";
import { csvField } from "@/lib/registrationForm";
import { PRIVACY_VERSION } from "@/lib/legal";
import { absoluteUrl } from "@/lib/seo";

// Newsletter da landing com consentimento registrado (LGPD art. 8º,
// auditoria 041). Assinar grava quando e sob qual versão da política; a
// newsletter só pode sair pra quem confirmou pelo link (confirmedAt). Sair
// apaga a linha: quem saiu não fica guardado.

/** tamanho máximo de um e-mail (RFC 5321) */
export const EMAIL_MAX = 254;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type SubscribeResult =
  | { ok: true; confirm: "sent" | "pending" | "already" }
  | { ok: false; error: string };

const token = () => randomBytes(24).toString("base64url");

export function validSubscriberEmail(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * Assina (ou reassina) e manda o e-mail de confirmação quando o canal
 * existe. Quem já confirmou não recebe outro. Sem driver, a linha fica
 * esperando a confirmação ("pending").
 */
export async function subscribe(rawEmail: unknown, env: DriverEnv = process.env): Promise<SubscribeResult> {
  const email = validSubscriberEmail(rawEmail);
  if (!email) return { ok: false, error: "e-mail inválido" };
  const row = await db
    .prepare(
      `INSERT INTO subscribers (email, consentAt, policyVersion, confirmToken, unsubscribeToken)
       VALUES (?, sqlite_now(), ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET
         consentAt = sqlite_now(),
         policyVersion = excluded.policyVersion,
         confirmToken = COALESCE(subscribers.confirmToken, excluded.confirmToken),
         unsubscribeToken = COALESCE(subscribers.unsubscribeToken, excluded.unsubscribeToken)
       RETURNING confirmedAt, confirmToken, unsubscribeToken`,
    )
    .get<{ confirmedAt: string | null; confirmToken: string | null; unsubscribeToken: string }>(
      email,
      PRIVACY_VERSION,
      token(),
      token(),
    );
  if (row?.confirmedAt) return { ok: true, confirm: "already" };
  let out: SendOutcome;
  try {
    out = await emailDriver(env).send(confirmationEmail(email, row!.confirmToken!, row!.unsubscribeToken));
  } catch (e) {
    out = { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, confirm: out.status === "sent" ? "sent" : "pending" };
}

function confirmationEmail(email: string, confirmToken: string, unsubscribeToken: string) {
  const confirmUrl = absoluteUrl(`/api/subscribe/confirm?token=${confirmToken}`);
  const unsubscribeUrl = absoluteUrl(`/api/subscribe/unsubscribe?token=${unsubscribeToken}`);
  const text = [
    "Você pediu pra receber a newsletter do HackaHub.",
    "",
    `Confirme aqui: ${confirmUrl}`,
    "",
    "Se não foi você, ignore este e-mail. Sem confirmação, nada é enviado.",
    `Sair da lista: ${unsubscribeUrl}`,
  ].join("\n");
  const html = text
    .split("\n")
    .map((l) => (l ? `<p>${l.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>` : ""))
    .join("");
  return {
    to: email,
    subject: "Confirme sua inscrição na newsletter do HackaHub",
    text,
    html,
    idempotencyKey: `newsletter-confirm-${confirmToken}`,
    unsubscribeUrl,
  };
}

/** confirma pelo link do e-mail; devolve false pra token desconhecido */
export async function confirmSubscriber(tok: string): Promise<boolean> {
  if (!tok) return false;
  const r = await db
    .prepare(
      `UPDATE subscribers SET confirmedAt = COALESCE(confirmedAt, sqlite_now())
       WHERE confirmToken = ? RETURNING id`,
    )
    .run(tok);
  return r.changes > 0;
}

/** sai da lista: apaga a linha. Token desconhecido (já saiu) também é ok */
export async function unsubscribe(tok: string): Promise<boolean> {
  if (!tok) return false;
  const r = await db.prepare("DELETE FROM subscribers WHERE unsubscribeToken = ? RETURNING id").run(tok);
  return r.changes > 0;
}

export type SubscriberRow = {
  email: string;
  createdAt: string;
  consentAt: string | null;
  policyVersion: string | null;
  confirmedAt: string | null;
};

export async function listSubscriberRows(): Promise<SubscriberRow[]> {
  return db
    .prepare(
      `SELECT email, createdAt, consentAt, policyVersion, confirmedAt
       FROM subscribers ORDER BY id DESC`,
    )
    .all<SubscriberRow>();
}

/**
 * Planilha dos assinantes. Campo que começa com = + - @ ganha um ' na
 * frente: e-mail como =HYPERLINK(...)@a.co passa na validação e viraria
 * fórmula no Excel ou no Sheets.
 */
export function subscribersCsv(rows: SubscriberRow[]): string {
  const lines = [
    "email,createdAt,consentAt,policyVersion,confirmedAt",
    ...rows.map((s) =>
      [s.email, s.createdAt, s.consentAt, s.policyVersion, s.confirmedAt].map((v) => csvField(v)).join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
