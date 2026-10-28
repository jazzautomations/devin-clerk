import type { NextConfig } from "next";
import { isProductionSite } from "./lib/site";

// CSP em modo relatório (achado sem-csp): o navegador só avisa no console o
// que bloquearia. 'unsafe-inline' em script fica até a versão com nonce no
// proxy.ts; o Clerk carrega script e fala com a API dele (instância dev no
// stage, clerk.<domínio> em produção).
// produção: clerk.<subdomínio> do domínio (o curinga cobre qualquer nível)
const CLERK = "https://*.clerk.accounts.dev https://*.jazzautomations.com.br";
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${CLERK} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${CLERK} https://clerk-telemetry.com`,
  // youtube-nocookie: embed do vídeo do time na vitrine /p (spec 046)
  `frame-src ${CLERK} https://challenges.cloudflare.com https://www.youtube-nocookie.com`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// lido no build (o deploy.sh carrega o env do ambiente antes do next build)
const indexable = isProductionSite(process.env.NEXT_PUBLIC_SITE_URL);

const nextConfig: NextConfig = {
  // Lets the dev server load its scripts through the public link from `npm run share`.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // e2e sobe um segundo `next dev` na porta 3100 — distDir separado pra
  // não disputar o .next do dev server do usuário
  distDir: process.env.HACKAHUB_DIST_DIR ?? ".next",
  poweredByHeader: false,
  // release enxuto: .next/standalone leva só o node_modules que o servidor
  // usa (o deploy.sh monta o release com ele, sem devDependencies)
  output: "standalone",
  // PGlite só existe pros testes sem DATABASE_URL; fora do bundle ele não
  // emite os .wasm (17 MB) em /_next/static/media, que qualquer bot baixava
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // câmera só pro próprio site: leitor de QR do check-in (spec 033 US4)
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
          // stage/preview são públicos: fora de produção nada entra em busca
          ...(indexable ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
