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
