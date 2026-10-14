import { defineConfig } from "@playwright/test";

// specs e server falam com o mesmo banco dedicado do e2e
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;

// E2e roda em produção buildada: `pretest:e2e` zera o banco do e2e
// (E2E_DATABASE_URL) e faz `next build` em .next-e2e; o webServer aqui sobe
// `next start` na 3100 apontado pra esse banco. Dois `next dev` no mesmo projeto dividem estado
// (o segundo serve subárvores de rota com 404) — além de não poluir o
// banco dev, modo start elimina os timeouts de cold-compile.
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command:
      "HACKAHUB_DIST_DIR=.next-e2e npm run start -- -p 3100",
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
