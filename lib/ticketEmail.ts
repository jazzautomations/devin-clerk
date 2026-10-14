import { after } from "next/server";
import QRCode from "qrcode";
import db from "@/lib/db";
import { ticketToken } from "@/lib/checkins";
import { emailDriver } from "@/lib/notify/email";
import type { DriverEnv, EmailMessage, SendOutcome } from "@/lib/notify/types";
import { absoluteUrl } from "@/lib/seo";

// E-mail de aprovação com o QR do ingresso (roadmap 037 Onda 1 #5, 035 #6):
// quem foi aprovado chega na porta com o QR na caixa de entrada e ninguém
// precisa logar no Clerk com o Wi-Fi da faculdade caindo.
//
// Outbox: toda transição pra 'approved' (inscrição direta, aprovação do
// admin, promoção da fila, walk-in) chama queueTicketEmail DENTRO da
// transação que aprovou — se a transação cai, a linha cai junto. O envio é
// de processTicketEmails, agendado com after() (roda depois da resposta,
// com a transação já confirmada) e reprocessado pelo cron das entregas.
// A PK de ticket_emails é a idempotência; reenvio manual incrementa "sends".
//
// QR como PNG inline por Content-ID (attachment com content_id no Resend,
// <img src="cid:ticket-qr">): Gmail e Outlook bloqueiam data: URI em <img>,
// e SVG não renderiza no Gmail/Outlook. CID é o que os clientes grandes
// mostram sem "exibir imagens" (é parte da mensagem, não imagem remota).

export const TICKET_QR_CID = "ticket-qr";
const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [1, 5];
const STALE_CLAIM_MIN = 10;

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/**
 * Enfileira o e-mail do ingresso pra inscrição (memberId, edição). Idempotente:
 * já existe linha → nada muda (não reenvia). Chamar na transação que aprovou.
 */
export async function queueTicketEmail(memberId: number, hackathonId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticket_emails (registrationId)
       SELECT id FROM registrations
       WHERE memberId = ? AND hackathonId = ? AND status = 'approved'
       ON CONFLICT ("registrationId") DO NOTHING`,
    )
    .run(memberId, hackathonId);
  scheduleTicketEmails();
}

/** roda o worker depois da resposta; fora de request (teste, script) é no-op */
export function scheduleTicketEmails(): void {
  try {
    after(async () => {
      try {
        await processTicketEmails(50);
      } catch (e) {
        console.error("[ticket-email] worker falhou", e);
      }
    });
  } catch {
    // after() fora de escopo de request: o cron das entregas pega depois
  }
}

/** reenvio manual do organizador: volta pra fila com chave de idempotência nova */
export async function requeueTicketEmail(
  registrationId: number,
  hackathonId: string,
  byMemberId: number | null,
): Promise<"queued" | "not_found" | "not_approved"> {
  const reg = await db
    .prepare("SELECT status FROM registrations WHERE id = ? AND hackathonId = ?")
    .get<{ status: string }>(registrationId, hackathonId);
  if (!reg) return "not_found";
  if (reg.status !== "approved") return "not_approved";
  await db
    .prepare(
      `INSERT INTO ticket_emails (registrationId, requestedBy) VALUES (?, ?)
       ON CONFLICT ("registrationId") DO UPDATE SET
         status = 'queued', sends = ticket_emails.sends + 1, attempts = 0,
         error = NULL, nextAttemptAt = NULL, claimedAt = NULL,
         requestedBy = excluded.requestedBy`,
    )
    .run(registrationId, byMemberId);
  scheduleTicketEmails();
  return "queued";
}

export type TicketEmailStatus = {
  status: "queued" | "sent" | "failed" | "skipped";
  sends: number;
  sentAt: string | null;
  error: string | null;
};

export async function getTicketEmailStatus(registrationId: number): Promise<TicketEmailStatus | null> {
  return (
    (await db
      .prepare("SELECT status, sends, sentAt, error FROM ticket_emails WHERE registrationId = ?")
      .get<TicketEmailStatus>(registrationId)) ?? null
  );
}

// ---------- render ----------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export type TicketEmailContent = {
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  location: string | null;
  /** sem local cadastrado, edição online diz "online" e as outras "local a confirmar" */
  format?: "online" | "presencial" | "hibrido" | null;
  memberName: string;
};

/** o que o e-mail diz no "onde" quando a edição não tem local cadastrado */
export function ticketWhere(location: string | null, format?: string | null): string {
  if (location?.trim()) return location.trim();
  return format === "online" ? "online" : "local a confirmar na página da edição";
}

function eventDate(startsAt: string): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return startsAt;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

export function renderTicketEmail(c: TicketEmailContent): { subject: string; html: string; text: string } {
  const ticketUrl = absoluteUrl(`/h/${c.hackathonId}/ingresso`);
  const subject = `[${c.hackathonName}] Inscrição confirmada — seu ingresso`;
  const when = `${eventDate(c.startsAt)} · ${ticketWhere(c.location, c.format)}`;
  const mono = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
  const sans = "Archivo,'Helvetica Neue',Arial,sans-serif";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#fefefe;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fefefe;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:2px solid #0c0c0c;background:#fefefe;">
<tr><td style="background:#0c0c0c;padding:8px 16px;font-family:${mono};font-size:13px;letter-spacing:.06em;color:#3ecf8e;text-transform:uppercase;">Hack Inova · ingresso</td></tr>
<tr><td style="padding:28px 24px 8px;font-family:${sans};">
<p style="margin:0 0 10px;font-family:${mono};font-size:12px;letter-spacing:.08em;color:#047a43;text-transform:uppercase;">${esc(c.hackathonName)}</p>
<h1 style="margin:0 0 12px;font-size:28px;line-height:1.1;font-weight:800;letter-spacing:-.02em;color:#0c0c0c;">${esc(c.memberName)}, sua vaga está confirmada</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#0c0c0c;">${esc(when)}</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0c0c0c;">Mostre este QR na entrada. Não precisa de login nem de internet na porta: vale o print ou este e-mail aberto.</p>
</td></tr>
<tr><td align="center" style="padding:8px 24px 16px;">
<img src="cid:${TICKET_QR_CID}" width="240" height="240" alt="QR do ingresso de ${esc(c.memberName)}" style="display:block;width:240px;height:240px;border:1.5px solid #0c0c0c;">
</td></tr>
<tr><td style="padding:8px 24px 28px;">
<a href="${esc(ticketUrl)}" style="display:inline-block;background:#047a43;color:#ffffff;font-family:${sans};font-size:15px;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:6px;">Abrir meu ingresso</a>
</td></tr>
<tr><td style="border-top:1.5px solid #0c0c0c;background:#d8f4e5;padding:16px 24px;font-family:${mono};font-size:12px;line-height:1.6;color:#474747;">
O QR é pessoal: não compartilhe. Se a imagem não aparecer, o ingresso também está em ${esc(ticketUrl)}.
</td></tr>
</table>
<p style="margin:12px 0 0;font-family:${mono};font-size:11px;color:#474747;">HackaHub · você recebe este e-mail porque se inscreveu em ${esc(c.hackathonName)}</p>
</td></tr></table>
</body></html>`;
  const text = [
    `${c.hackathonName} — inscrição confirmada`,
    "",
    `${c.memberName}, sua vaga está confirmada.`,
    when,
    "",
    "Mostre o QR (imagem anexa) na entrada. Não precisa de login na porta.",
    `Seu ingresso: ${ticketUrl}`,
  ].join("\n");
  return { subject, html, text };
}

export async function ticketQrPng(registrationId: number): Promise<Buffer> {
  return QRCode.toBuffer(ticketToken(registrationId), {
    type: "png",
    width: 480,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0c0c0cff", light: "#fefefeff" },
  });
}

export async function buildTicketEmail(
  row: TicketEmailContent & { registrationId: number; email: string; sends: number },
): Promise<EmailMessage> {
  const { subject, html, text } = renderTicketEmail(row);
  const png = await ticketQrPng(row.registrationId);
  return {
    to: row.email,
    subject,
    html,
    text,
    idempotencyKey: `ticket-${row.registrationId}-${row.sends}`,
    attachments: [
      {
        filename: "ingresso-qr.png",
        content: png.toString("base64"),
        contentType: "image/png",
        contentId: TICKET_QR_CID,
      },
    ],
  };
}

// ---------- worker ----------

type ClaimedRow = {
  registrationId: number;
  sends: number;
  attempts: number;
  status: string;
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  location: string | null;
  format: "online" | "presencial" | "hibrido";
  email: string;
  name: string | null;
  username: string;
  emailBouncedAt: string | null;
};

export type TicketProcessResult = { processed: number; sent: number; failed: number; skipped: number };

/**
 * Manda os e-mails pendentes. Trava as linhas com claimedAt + SKIP LOCKED
 * (after() e cron juntos não pegam a mesma); inscrição que deixou de ser
 * aprovada antes do envio vira 'skipped'.
 */
export async function processTicketEmails(
  limit = 50,
  opts: { now?: Date; env?: DriverEnv } = {},
): Promise<TicketProcessResult> {
  const now = opts.now ?? new Date();
  const nowText = sqlTime(now);
  const claimed = await db
    .prepare(
      `WITH claimed AS (
         UPDATE ticket_emails SET claimedAt = @now
         WHERE registrationId IN (
           SELECT registrationId FROM ticket_emails
           WHERE (status = 'queued'
                  OR (status = 'failed' AND nextAttemptAt IS NOT NULL AND nextAttemptAt <= @now))
             AND (claimedAt IS NULL OR claimedAt < @stale)
           ORDER BY createdAt, registrationId
           LIMIT @limit
           FOR UPDATE SKIP LOCKED)
         RETURNING registrationId, sends, attempts)
       SELECT c.registrationId, c.sends, c.attempts, r.status, r.hackathonId,
              h.name AS hackathonName, h.startsAt, h.location, h.format,
              m.email, m.name, m.username, m.emailBouncedAt
       FROM claimed c
       JOIN registrations r ON r.id = c.registrationId
       JOIN hackathons h ON h.id = r.hackathonId
       JOIN members m ON m.id = r.memberId
       ORDER BY c.registrationId`,
    )
    .all<ClaimedRow>({ now: nowText, stale: sqlTime(addMin(now, -STALE_CLAIM_MIN)), limit });

  const result: TicketProcessResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  if (claimed.length === 0) return result;
  const driver = emailDriver(opts.env ?? process.env);
  const finish = db.prepare(
    `UPDATE ticket_emails SET status = @status, error = @error, attempts = @attempts,
       nextAttemptAt = @next, sentAt = COALESCE(@sentAt, sentAt), claimedAt = NULL
     WHERE registrationId = @id`,
  );
  for (const row of claimed) {
    let out: SendOutcome;
    if (row.status !== "approved") {
      out = { status: "skipped", reason: "inscrição não está mais aprovada" };
    } else if (row.emailBouncedAt) {
      out = { status: "skipped", reason: "e-mail com bounce registrado" };
    } else {
      try {
        out = await driver.send(
          await buildTicketEmail({
            registrationId: row.registrationId,
            sends: row.sends,
            email: row.email,
            hackathonId: row.hackathonId,
            hackathonName: row.hackathonName,
            startsAt: row.startsAt,
            location: row.location,
            format: row.format,
            memberName: row.name ?? `@${row.username}`,
          }),
        );
      } catch (e) {
        out = { status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
    }
    const attempts = row.attempts + 1;
    const retry =
      out.status === "failed" && !out.permanent && attempts < MAX_ATTEMPTS
        ? sqlTime(addMin(now, BACKOFF_MIN[attempts - 1] ?? BACKOFF_MIN.at(-1)!))
        : null;
    await finish.run({
      id: row.registrationId,
      status: out.status,
      error: out.status === "failed" ? out.error : out.status === "skipped" ? out.reason : null,
      attempts,
      next: retry,
      sentAt: out.status === "sent" ? nowText : null,
    });
    result.processed++;
    result[out.status]++;
  }
  return result;
}
