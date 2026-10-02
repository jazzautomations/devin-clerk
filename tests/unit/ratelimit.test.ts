import { beforeEach, describe, expect, it } from "vitest";
import {
  clientIp,
  limitOrNull,
  rateLimit,
  rateLimitSize,
  resetRateLimits,
} from "@/lib/ratelimit";

// spec 031 — limiter puro: `now` injetável deixa a janela determinística
// (sem sleep). O estado é módulo-global → resetRateLimits entre casos.

const W = 60_000; // janela de teste: 1 min

beforeEach(() => {
  resetRateLimits();
});

describe("rateLimit — janela deslizante", () => {
  it("permite até `limit` chamadas e bloqueia a próxima", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", { limit: 3, windowMs: W }, t + i).ok).toBe(true);
    }
    const r = rateLimit("k", { limit: 3, windowMs: W }, t + 3);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("retryAfterSec = ceil((hit mais antigo + janela - now) / 1000)", () => {
    const t = 1_000_000;
    rateLimit("k", { limit: 2, windowMs: W }, t); // expira em t+60000
    rateLimit("k", { limit: 2, windowMs: W }, t + 1_000); // expira t+61000
    const r = rateLimit("k", { limit: 2, windowMs: W }, t + 30_500);
    expect(r.ok).toBe(false);
    // o mais antigo (t) expira em t+60000 → faltam 29500ms → ceil = 30s
    expect(r.retryAfterSec).toBe(30);
  });

  it("hit bloqueado não entra na contagem (não estende a punição)", () => {
    const t = 1_000_000;
    rateLimit("k", { limit: 1, windowMs: W }, t);
    // negadas em t+1, t+2… não adiam a liberação: em t+W+1 já passa
    rateLimit("k", { limit: 1, windowMs: W }, t + 1_000);
    rateLimit("k", { limit: 1, windowMs: W }, t + 2_000);
    expect(rateLimit("k", { limit: 1, windowMs: W }, t + W + 1).ok).toBe(true);
  });

  it("janela desliza: expirou o mais antigo → vaga, sem esperar a hora fechar", () => {
    const t = 1_000_000;
    rateLimit("k", { limit: 2, windowMs: W }, t);
    rateLimit("k", { limit: 2, windowMs: W }, t + 10_000);
    expect(rateLimit("k", { limit: 2, windowMs: W }, t + 20_000).ok).toBe(false);
    // em t+60001 o primeiro hit saiu da janela → uma vaga
    expect(rateLimit("k", { limit: 2, windowMs: W }, t + 60_001).ok).toBe(true);
    // mas o segundo ainda conta → a próxima bloqueia de novo
    expect(rateLimit("k", { limit: 2, windowMs: W }, t + 60_002).ok).toBe(false);
  });

  it("isola por chave — k estourada não derruba as vizinhas", () => {
    const t = 1_000_000;
    rateLimit("a", { limit: 1, windowMs: W }, t);
    expect(rateLimit("a", { limit: 1, windowMs: W }, t + 1).ok).toBe(false);
    expect(rateLimit("b", { limit: 1, windowMs: W }, t + 1).ok).toBe(true);
  });

  it("varredura remove chaves vencidas — o Map não cresce pra sempre", () => {
    const t = 1_000_000;
    rateLimit("a", { limit: 1, windowMs: W }, t);
    rateLimit("b", { limit: 1, windowMs: W }, t);
    expect(rateLimitSize()).toBe(2);
    // >60s de atividade depois → a chamada dispara a varredura, que
    // apaga 'a' e 'b' (janela de 60s vencida) e fica só a 'c'
    rateLimit("c", { limit: 1, windowMs: W }, t + 61_001);
    expect(rateLimitSize()).toBe(1);
  });
});

describe("clientIp — origem da chave pública", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://t/x", { headers });

  it("pega o PRIMEIRO hop do x-forwarded-for", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" })),
    ).toBe("1.2.3.4");
  });

  it("cai no x-real-ip sem xff; 'anon' sem nenhum dos dois", () => {
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(req({}))).toBe("anon");
    expect(clientIp(req({ "x-forwarded-for": "  " }))).toBe("anon");
  });
});

describe("limitOrNull — resposta pronta pras rotas", () => {
  const req = (ip = "1.1.1.1") =>
    new Request("http://t/x", { headers: { "x-forwarded-for": ip } });
  const opts = { limit: 2, windowMs: 60_000 };

  it("null dentro do limite; 429 + Retry-After + msg pt-BR ao estourar", async () => {
    expect(limitOrNull(req(), "leads", null, opts)).toBeNull();
    expect(limitOrNull(req(), "leads", null, opts)).toBeNull();
    const res = limitOrNull(req(), "leads", null, opts);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    const retry = res!.headers.get("retry-after");
    expect(retry).toBeTruthy();
    const { error } = (await res!.json()) as { error: string };
    expect(error).toContain("muitas requisições");
    expect(error).toContain(`${retry}s`);
  });

  it("key explícita (memberId) ganha do IP; buckets são independentes", () => {
    const r = () => req("2.2.2.2");
    const tight = { limit: 1, windowMs: 60_000 };
    expect(limitOrNull(r(), "comments", 42, tight)).toBeNull();
    expect(limitOrNull(r(), "comments", 42, tight)?.status).toBe(429); // membro 42 estourou
    expect(limitOrNull(r(), "comments", 43, tight)).toBeNull(); // outro membro livre
    expect(limitOrNull(r(), "posts", 42, tight)).toBeNull(); // outro bucket livre
    expect(limitOrNull(r(), "comments", null, tight)).toBeNull(); // ip livre
  });
});
