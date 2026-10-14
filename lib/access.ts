// spec 039 — quem vê o quê sem login. ALLOWLIST: rota que não está aqui
// exige login (página deslogada → /sign-up com redirect_url; API → 401
// JSON). Módulo puro: o proxy usa e o teste unitário cobre cada linha.

const SEG = "[^/]+";

/** páginas abertas a quem não tem conta */
export const PUBLIC_PAGES: RegExp[] = [
  /^\/$/, // landing: explica o produto inteiro
  /^\/organizar$/,
  /^\/empresas$/, // a porta do patrocinador (lead sem conta, spec 022)
  /^\/legal(\/.*)?$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  new RegExp(`^/c/${SEG}(/pdf)?$`), // verificação de certificado (recrutador, LinkedIn)
  new RegExp(`^/h/${SEG}$`), // teaser público da edição (divulgação)
  new RegExp(`^/h/${SEG}/conduta$`), // termo da edição
  new RegExp(`^/h/${SEG}/incidente$`), // relato anônimo, por segurança
  new RegExp(`^/h/${SEG}/telao$`), // telão da final, no projetor sem login
  new RegExp(`^/h/${SEG}/programacao\\.ics$`), // assinatura webcal: app de calendário não loga
  new RegExp(`^/u/${SEG}$`), // cartão público mínimo do perfil
  new RegExp(`^/p/${SEG}$`), // cartão público mínimo do projeto
  new RegExp(`^/rsvp/${SEG}$`), // link assinado do e-mail de confirmação
  /^\/demo\/.+$/, // demo publicada do time (o app do time roda no proxy, sem login)
  /^\/sitemap\.xml$/,
  /^\/robots\.txt$/,
  /(^|\/)opengraph-image(-\w+)?$/, // OG das rotas públicas (/, /h, /u, /p)
];

/** APIs abertas: saúde, formulários públicos, links assinados, cron e telão */
export const PUBLIC_APIS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/leads$/, // contato do /organizar e /empresas
  /^\/api\/subscribe(\/(confirm|unsubscribe))?$/, // newsletter da landing + links do e-mail
  /^\/api\/webhooks\/.+$/, // assinatura própria
  /^\/api\/cron\/.+$/, // segredo próprio (lib/cronAuth)
  new RegExp(`^/api/rsvp/${SEG}$`), // token assinado
  new RegExp(`^/api/me/calendar/${SEG}$`), // feed .ics pessoal por token
  new RegExp(`^/api/hackathons/${SEG}/incidents$`), // relato anônimo
  new RegExp(`^/api/hackathons/${SEG}/stage(/stream)?$`), // estado do telão
];

/** rotas logadas que não passam pelo onboarding (evita loop) */
const ONBOARDING_EXEMPT: RegExp[] = [/^\/bem-vindo(\/.*)?$/, /^\/api\//, /^\/sign-(in|up)(\/.*)?$/];

export const isPublicPage = (path: string) => PUBLIC_PAGES.some((r) => r.test(path));
export const isPublicApi = (path: string) => PUBLIC_APIS.some((r) => r.test(path));
export const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

/** o que fazer com a request, dado o caminho e se tem sessão */
export type AccessDecision = "next" | "unauthorized" | "signup" | "onboarding";

export function decideAccess(
  path: string,
  opts: { signedIn: boolean; onboarded: boolean },
): AccessDecision {
  if (isApi(path)) {
    if (isPublicApi(path) || opts.signedIn) return "next";
    return "unauthorized";
  }
  if (isPublicPage(path)) return "next";
  if (!opts.signedIn) return "signup";
  if (!opts.onboarded && !ONBOARDING_EXEMPT.some((r) => r.test(path))) return "onboarding";
  return "next";
}

/** cookie que lembra "esta conta já passou pelo onboarding" neste navegador */
export const ONBOARDED_COOKIE = "hh_onb";

/** Set-Cookie do onboarding: só o userId (nada sensível), 1 ano, httpOnly */
export function onboardedCookie(userId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ONBOARDED_COOKIE}=${encodeURIComponent(userId)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
}
