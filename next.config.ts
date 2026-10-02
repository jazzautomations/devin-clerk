import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server load its scripts through the public link from `npm run share`.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // e2e sobe um segundo `next dev` na porta 3100 — distDir separado pra
  // não disputar o .next do dev server do usuário
  distDir: process.env.HACKAHUB_DIST_DIR ?? ".next",
};

export default nextConfig;
