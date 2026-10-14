// Domínio canônico de produção. Qualquer outro SITE_URL (stage, e2e, dev,
// placeholder) é ambiente de teste: robots fecha tudo e as respostas saem
// com X-Robots-Tag: noindex (next.config.ts). Sem dependências: o
// next.config importa este arquivo.
export const PROD_SITE_URL = "https://hackahub.jazzautomations.com.br";

export function isProductionSite(siteUrl: string | undefined): boolean {
  return (siteUrl ?? "").replace(/\/+$/, "") === PROD_SITE_URL;
}
