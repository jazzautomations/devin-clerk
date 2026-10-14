import { describe, expect, it } from "vitest";
import { DEMO_CSP, demoRequestHeaders, demoResponseHeaders } from "@/lib/demoProxy";
import { runnerEnv } from "@/lib/deploys";

// achado demo-proxy-vaza-sessao: a demo é código de terceiros servido na
// origem do app.
describe("proxy de demos — sessão de quem visita não sai do app", () => {
  it("tira cookie, authorization e x-clerk-* da requisição", () => {
    const h = demoRequestHeaders(
      new Headers({
        cookie: "__session=jwt; __client_uat=1",
        authorization: "Bearer jwt",
        "x-clerk-auth-status": "signed-in",
        host: "hackahub",
        accept: "text/html",
      }),
    );
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBeNull();
    expect(h.get("x-clerk-auth-status")).toBeNull();
    expect(h.get("host")).toBeNull();
    expect(h.get("accept")).toBe("text/html");
  });

  it("não repassa Set-Cookie do container e põe a página em sandbox", () => {
    const up = new Headers({ "content-type": "text/html", "content-security-policy": "default-src *" });
    up.append("set-cookie", "__session=roubado; Path=/");
    const out = demoResponseHeaders(up);
    expect(out.get("set-cookie")).toBeNull();
    expect(out.get("content-security-policy")).toBe(DEMO_CSP);
    expect(DEMO_CSP).toMatch(/^sandbox\b/);
    expect(DEMO_CSP).not.toContain("allow-same-origin");
    expect(out.get("content-type")).toBe("text/html");
  });
});

describe("runner do deploy recebe só o env que usa", () => {
  it("passa banco e PATH, nunca segredo do Clerk ou HMAC", () => {
    const env = runnerEnv({
      PATH: "/usr/bin",
      HOME: "/home/ubuntu",
      DATABASE_URL: "postgres://x",
      CLERK_SECRET_KEY: "sk_live",
      HACKAHUB_TICKET_SECRET: "t",
      HACKAHUB_CRON_SECRET: "c",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/ubuntu", DATABASE_URL: "postgres://x" });
  });
});
