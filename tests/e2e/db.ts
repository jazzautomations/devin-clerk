import db from "@/lib/db";

// Banco DEDICADO do e2e — o Playwright sobe um server próprio (porta 3100)
// apontado pro DATABASE_URL do e2e (ver playwright.config.ts). Seeds dos specs
// vêm aqui, nunca no banco dev.
export function openE2eDb() {
  return db;
}
