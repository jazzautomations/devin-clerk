import Database from "better-sqlite3";
import { join } from "node:path";

// Banco DEDICADO do e2e — o Playwright sobe um server próprio (porta 3100)
// com HACKAHUB_DB=data/e2e.db. Seeds dos specs vêm aqui, nunca no dev DB
// (data/hackahub.db), que é o que o usuário navega no tunnel.
export function openE2eDb() {
  return new Database(join(process.cwd(), "data", "e2e.db"));
}
