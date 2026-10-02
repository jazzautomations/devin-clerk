import { defineConfig } from "@playwright/test";

// E2e roda em produção buildada: `pretest:e2e` reseta data/e2e.db e faz
// `next build` em .next-e2e; o webServer aqui sobe `next start` na 3100
// com HACKAHUB_DB isolado. Dois `next dev` no mesmo projeto dividem estado
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
      "HACKAHUB_DB=data/e2e.db HACKAHUB_DIST_DIR=.next-e2e npm run start -- -p 3100",
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
