// Versões dos textos legais da plataforma. A newsletter grava a versão da
// política que estava no ar quando a pessoa assinou (subscribers.policyVersion);
// mudou o texto de forma relevante, sobe a versão e a data aqui.

export const PRIVACY_VERSION = "1.1";
export const PRIVACY_UPDATED = "14/10/2026";

export const TERMS_VERSION = "1.0";
export const TERMS_UPDATED = "out/2026";

/**
 * E-mail pra pedidos de titular (LGPD art. 18). Vem do env porque o
 * endereço depende do encarregado que o fundador nomear; sem ele, a página
 * aponta pro autoatendimento do /perfil e pro formulário de contato.
 */
export function privacyEmail(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.HACKAHUB_PRIVACY_EMAIL?.trim();
  return v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}
