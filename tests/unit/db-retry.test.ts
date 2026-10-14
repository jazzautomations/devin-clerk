import { afterEach, describe, expect, it, vi } from "vitest";

// achado db-promise-rejeitada-cacheada: boot com o Postgres fora não pode
// travar o processo. A 1ª chamada falha; quando o banco volta, a próxima
// tenta de novo em vez de devolver a mesma promessa rejeitada.
describe("lib/db — driver tenta de novo depois de falhar no boot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("porta fechada rejeita; trocar a URL faz a chamada seguinte funcionar", async () => {
    (globalThis as { __hackahubDb?: unknown }).__hackahubDb = undefined;
    vi.stubEnv("DATABASE_URL", "postgres://x:y@127.0.0.1:1/nada");
    const { default: db } = await import("@/lib/db");
    await expect(db.prepare("SELECT 1 AS ok").get()).rejects.toThrow();

    // banco "voltou": sem DATABASE_URL o driver sobe o PGlite em memória
    vi.stubEnv("DATABASE_URL", "");
    const row = await db.prepare("SELECT 1 AS ok").get<{ ok: number }>();
    expect(row?.ok).toBe(1);
  });
});
