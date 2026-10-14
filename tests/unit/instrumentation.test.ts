import { describe, expect, it } from "vitest";
import { requestErrorLine } from "@/instrumentation";

describe("onRequestError — log de uma linha com rota", () => {
  it("grava digest, rota e método em JSON, sem a query string", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5434"), { digest: "1711552501" });
    const line = requestErrorLine(
      err,
      { path: "/rsvp/abc?token=segredo", method: "GET" },
      { routePath: "/rsvp/[token]", routeType: "render" },
    );
    expect(line).not.toContain("\n");
    const j = JSON.parse(line);
    expect(j).toMatchObject({
      evt: "request_error",
      digest: "1711552501",
      method: "GET",
      path: "/rsvp/abc",
      routePath: "/rsvp/[token]",
      routeType: "render",
    });
    expect(j.msg).toContain("ECONNREFUSED");
    expect(line).not.toContain("segredo");
    expect(Date.parse(j.ts)).not.toBeNaN();
  });

  it("aguenta erro que não é Error", () => {
    const j = JSON.parse(requestErrorLine("quebrou", { path: "/x", method: "POST" }, { routePath: "/x", routeType: "route" }));
    expect(j.msg).toBe("quebrou");
    expect(j.digest).toBeUndefined();
  });
});
