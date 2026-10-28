import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    // sem DATABASE_URL → lib/db usa PGlite em memória (Postgres real, um por arquivo)
    // dossiê (migration 029): GitHub aponta pra porta fechada — teste que
    // esquecer o mock falha rápido em vez de ir pra rede de verdade
    env: {
      DATABASE_URL: "",
      HACKAHUB_DEPLOY_TOOL: "on",
      HACKAHUB_ALLOW_MINORS: "on",
      HACKAHUB_GITHUB_API: "http://127.0.0.1:9",
      GITHUB_TOKEN: "",
    },
    testTimeout: 20_000,
    hookTimeout: 30_000,
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
  },
});
