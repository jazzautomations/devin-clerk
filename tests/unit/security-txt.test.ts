import { describe, expect, it } from "vitest";
import { GET } from "@/app/.well-known/security.txt/route";

describe("/.well-known/security.txt (RFC 9116)", () => {
  it("tem Contact e Expires no futuro, em texto puro", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toMatch(/^Contact: mailto:\S+@\S+$/m);
    const exp = body.match(/^Expires: (.+)$/m)?.[1];
    expect(Date.parse(exp!)).toBeGreaterThan(Date.now());
  });
});
