import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server load its scripts through the public link from `npm run share`.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // e2e sobe um segundo `next dev` na porta 3100 — distDir separado pra
  // não disputar o .next do dev server do usuário
  distDir: process.env.HACKAHUB_DIST_DIR ?? ".next",
  poweredByHeader: false,
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
        ],
      },
    ];
  },
};

export default nextConfig;
