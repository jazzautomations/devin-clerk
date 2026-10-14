import {
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

export function emailDriver(env: DriverEnv = process.env): Driver<EmailMessage> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    return {
      name: "log",
      async send(m) {
        console.info(`[notify:email:log] ${m.idempotencyKey} (não enviado)`);
        return { status: "skipped", reason: "RESEND_API_KEY ausente — driver log, nada enviado" };
      },
    };
  }
  const from = env.HACKAHUB_EMAIL_FROM || DEFAULT_FROM;
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
