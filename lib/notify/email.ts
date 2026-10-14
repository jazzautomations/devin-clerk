import {
  NO_DRIVER,
  networkFailure,
  outcomeFromResponse,
  type Driver,
  type DriverEnv,
  type EmailMessage,
} from "@/lib/notify/types";

// E-mail via Resend, HTTP puro (sem SDK). Sem RESEND_API_KEY o driver é
// "log": marca skipped com o motivo e não chama rede — dev e testes nunca
// mandam e-mail de verdade.
export const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Hack Inova <avisos@hackahub.dev>";

/** endereço de resposta configurado, ou null (a copy só promete resposta quando existe) */
export function emailReplyTo(env: DriverEnv = process.env): string | null {
  return env.RESEND_API_KEY ? env.HACKAHUB_EMAIL_REPLY_TO?.trim() || null : null;
}

export function emailDriver(env: DriverEnv = process.env): Driver<EmailMessage> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    return {
      name: "log",
      async send(m) {
        console.info(`[notify:email:log] ${m.idempotencyKey} (não enviado)`);
        return {
          status: "skipped",
          reason: "RESEND_API_KEY ausente — driver log, nada enviado",
          code: NO_DRIVER,
        };
      },
    };
  }
  const from = env.HACKAHUB_EMAIL_FROM || DEFAULT_FROM;
  // o remetente costuma ser um endereço que ninguém lê; a resposta vai pra
  // um e-mail real da organização (HACKAHUB_EMAIL_REPLY_TO) ou pro que a
  // mensagem pedir
  const defaultReplyTo = env.HACKAHUB_EMAIL_REPLY_TO?.trim() || undefined;
  return {
    name: "resend",
    async send(m) {
      try {
        const res = await fetch(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": m.idempotencyKey,
          },
          body: JSON.stringify({
            from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            ...((m.replyTo || defaultReplyTo) ? { reply_to: m.replyTo || defaultReplyTo } : {}),
            ...(m.attachments?.length
              ? {
                  attachments: m.attachments.map((a) => ({
                    filename: a.filename,
                    content: a.content,
                    ...(a.contentType ? { content_type: a.contentType } : {}),
                    ...(a.contentId ? { content_id: a.contentId } : {}),
                  })),
                }
              : {}),
            ...(m.unsubscribeUrl
              ? { headers: { "List-Unsubscribe": `<${m.unsubscribeUrl}>` } }
              : {}),
          }),
        });
        return await outcomeFromResponse(res);
      } catch (e) {
        return networkFailure(e);
      }
    },
  };
}
