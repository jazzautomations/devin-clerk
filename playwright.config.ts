import { defineConfig } from "@playwright/test";

// specs e server falam com o mesmo banco dedicado do e2e
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
// porta própria por worktree quando vários e2e rodam na mesma máquina
const PORT = Number(process.env.E2E_PORT ?? 3100);
// segredo do link do RSVP compartilhado entre o server (herda process.env)
// e os specs que geram token — o server roda em modo produção
process.env.HACKAHUB_RSVP_SECRET ||= "e2e-rsvp-secret-nao-usar-em-producao";
// dossiê (migration 029): o server lê o "GitHub" de um servidor falso local
// (tests/e2e/github-mock.mjs) — e2e nunca vai pra api.github.com
const GITHUB_MOCK_PORT = PORT + 1000;
process.env.HACKAHUB_GITHUB_API = `http://127.0.0.1:${GITHUB_MOCK_PORT}`;
process.env.GITHUB_TOKEN = "";

// E2e roda em produção buildada: `pretest:e2e` zera o banco do e2e
// (E2E_DATABASE_URL) e faz `next build` em .next-e2e; o webServer aqui sobe
// `next start` na 3100 apontado pra esse banco. Dois `next dev` no mesmo projeto dividem estado
// (o segundo serve subárvores de rota com 404) — além de não poluir o
// banco dev, modo start elimina os timeouts de cold-compile.
export default defineConfig({
  testDir: "./tests/e2e",
  // spec 039 — sessão de um membro de teste pros specs da área logada
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: [
    {
      command: `node tests/e2e/github-mock.mjs ${GITHUB_MOCK_PORT}`,
      url: `http://127.0.0.1:${GITHUB_MOCK_PORT}/health`,
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command:
        `HACKAHUB_DEPLOY_TOOL=on HACKAHUB_ALLOW_MINORS=on HACKAHUB_DIST_DIR=.next-e2e npm run start -- -p ${PORT}`,
      port: PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
