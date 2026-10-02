import { expect, test } from "@playwright/test";

// spec 031 — o limiter chaveia por `x-forwarded-for` (primeiro hop) →
// `x-real-ip` → 'anon'. Aqui a gente falsifica o header pra simular um IP
// único POR RUN: o dev server é compartilhado entre specs e persiste entre
// execuções, então um IP aleatório evita esgotar o bucket 'anon' dos outros
// e2e e evita colisão quando o teste roda de novo no mesmo server.

const rand = () => Math.floor(Math.random() * 254) + 1;
const IP = `10.${rand()}.${rand()}.${rand()}`; // único por run

const lead = (n: number) => ({
  company: "Spam RL",
  email: `rl-${Date.now()}-${n}@empresa.dev`, // e-mail distinto — dedupe não interfere
  interest: "outro",
});

test.describe("POST /api/leads — rate limit por IP", () => {
  test("5 passam; a 6ª do mesmo IP → 429 com Retry-After", async ({
    request,
  }) => {
    const headers = { "x-forwarded-for": IP };
    for (let i = 0; i < 5; i++) {
      const res = await request.post("/api/leads", {
        headers,
        data: lead(i),
      });
      expect(res.status()).toBe(201);
    }

    const blocked = await request.post("/api/leads", {
      headers,
      data: lead(5),
    });
    expect(blocked.status()).toBe(429);
    const retry = blocked.headers()["retry-after"];
    expect(retry).toBeTruthy();
    const { error } = await blocked.json();
    expect(error).toContain("muitas requisições");
    expect(error).toContain(`${retry}s`);

    // outro IP segue livre — o limite é por chave, não global
    const other = await request.post("/api/leads", {
      headers: { "x-forwarded-for": `10.${rand()}.${rand()}.${rand()}` },
      data: lead(99),
    });
    expect(other.status()).toBe(201);
  });
});
