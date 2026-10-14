import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("headers de segurança (next.config)", () => {
  it("toda rota sai com HSTS, nosniff, anti-clickjacking e câmera só do próprio site", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    const h = Object.fromEntries(all!.headers.map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toContain("camera=(self)");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("headers de plataforma (pacote A da auditoria)", () => {
  it("CSP em modo relatório, sem quebrar nada enquanto não tem nonce", async () => {
    const rules = await nextConfig.headers!();
    const h = Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toBeUndefined();
    const csp = h["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("clerk");
  });

  it("fora do domínio de produção toda resposta sai com noindex", async () => {
    // vitest roda sem NEXT_PUBLIC_SITE_URL de produção
    const rules = await nextConfig.headers!();
    const h = Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((x) => [x.key, x.value]));
    expect(h["X-Robots-Tag"]).toContain("noindex");
  });

  it("PGlite e pg fora do bundle; build standalone", () => {
    expect(nextConfig.serverExternalPackages).toEqual(expect.arrayContaining(["@electric-sql/pglite", "pg"]));
    expect(nextConfig.output).toBe("standalone");
  });
});
