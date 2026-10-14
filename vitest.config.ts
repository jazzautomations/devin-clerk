import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    // sem DATABASE_URL → lib/db usa PGlite em memória (Postgres real, um por arquivo)
    env: { DATABASE_URL: "" },
    testTimeout: 20_000,
    hookTimeout: 30_000,
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
  },
});
