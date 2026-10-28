// Contrato dos drivers de entrega (spec 033 US2). Driver nunca lança: erro
// de rede/HTTP vira { status: "failed" } e o worker decide se tenta de novo.
// "skipped" = não era pra sair (sem env do canal, sem opt-in, bounce) — fica
// registrado com o motivo, pra o admin ver "pulado" e não "entregue".
export type SendOutcome =
  | { status: "sent" }
  | { status: "skipped"; reason: string; code?: SkipCode }
  | { status: "failed"; error: string; permanent?: boolean };

/**
 * Motivo de skip que tem conserto do lado da plataforma. `no_driver` = o
 * canal não está configurado neste ambiente (sem chave do Resend ou do
 * Evolution). Fica gravado em deliveries.reason pra o painel agrupar o
 * motivo e pra reenfileirar quando a chave aparecer.
 */
export type SkipCode = "no_driver";
export const NO_DRIVER: SkipCode = "no_driver";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** chave estável por (aviso, membro): o Resend descarta reenvio com a mesma */
  idempotencyKey: string;
  /** vira header List-Unsubscribe (Gmail/Outlook mostram "cancelar inscrição") */
  unsubscribeUrl?: string;
  /**
   * a URL acima desliga com um POST sem corpo: manda também
   * List-Unsubscribe-Post (RFC 8058) e o Gmail/Yahoo cancelam num clique.
   * Só pra URL que aceita POST — página de preferências não.
   */
  oneClickUnsubscribe?: boolean;
  /** endereço que recebe a resposta; sem ele vale HACKAHUB_EMAIL_REPLY_TO */
  replyTo?: string;
  /** anexos; com contentId viram imagem inline (<img src="cid:…">) */
  attachments?: EmailAttachment[];
};

export type EmailAttachment = {
  filename: string;
  /** conteúdo em base64 */
  content: string;
  contentType?: string;
  /** Content-ID pra imagem inline — referenciado no HTML como cid:<contentId> */
  contentId?: string;
};

export type WhatsappMessage = {
  /** E.164 sem "+", ex. 5511999999999 */
  number: string;
  text: string;
};

export interface Driver<M> {
  name: string;
  send(message: M): Promise<SendOutcome>;
}

export type DriverEnv = Record<string, string | undefined>;

/** resposta HTTP → outcome. 4xx (menos 408/429) não melhora tentando de novo */
export async function outcomeFromResponse(res: Response): Promise<SendOutcome> {
  if (res.ok) return { status: "sent" };
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  const permanent =
    res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
  return { status: "failed", error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`, permanent };
}

export function networkFailure(e: unknown): SendOutcome {
  const msg = e instanceof Error ? e.message : String(e);
  return { status: "failed", error: `rede: ${msg}`.slice(0, 300) };
}
