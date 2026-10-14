// Mensagem de erro de API pra mostrar na tela. As rotas devolvem códigos em
// inglês ("Unauthorized", "Forbidden", "Not found") pra quem integra; quem
// usa o site lê o que aconteceu e o que fazer. Mensagem própria da rota em
// PT-BR (400, 409, 429) passa direto.

const RAW = /^(unauthorized|forbidden|not found|bad request|member not found|internal server error)$/i;

export function userMessage(
  res: { status: number },
  data: unknown,
  fallback: string,
): string {
  const raw =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? ((data as { error: string }).error.trim() || null)
      : null;
  const own = raw && !RAW.test(raw) ? raw : null;
  if (res.status === 401) return "sua sessão expirou. Entre de novo e repita.";
  if (res.status >= 500) return fallback;
  if (own) return own;
  if (res.status === 403) return "você não tem acesso a isso.";
  if (res.status === 404) return "não encontramos isso. Recarregue a página.";
  return fallback;
}
