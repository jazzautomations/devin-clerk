import db from "@/lib/db";

// Banco DEDICADO do e2e — o Playwright sobe um server próprio (porta 3100)
// apontado pro DATABASE_URL do e2e (ver playwright.config.ts). Seeds dos specs
// vêm aqui, nunca no banco dev.
export function openE2eDb() {
  return db;
}

/**
 * Arquivo e desafio de teste. O seed não traz mais pódio nem desafio (os
 * antigos eram inventados — migration 025), então os specs que precisam de
 * uma edição encerrada com resultado e de um desafio só-texto criam aqui.
 * Idempotente.
 */
export async function seedArquivoE2E(): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO teams (hackathonId, name, placement) VALUES ('hack-inova-unifacens-2026', 'E2E Campeão', 1)")
    .run();
  const team = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = 'hack-inova-unifacens-2026' AND name = 'E2E Campeão'")
    .get<{ id: number }>();
  await db
    .prepare("INSERT OR IGNORE INTO team_projects (teamId, title, description) VALUES (?, 'E2E Campeão', 'projeto de teste do e2e')")
    .run(team!.id);
  await db
    .prepare(
      `INSERT OR IGNORE INTO challenges (id, hackathonId, sponsor, title, description, prize)
       VALUES ('e2e-desafio-texto', 'hack-inova-puc-saude-2026', 'Marca Teste', 'Desafio e2e só texto', 'desafio de teste', 'prêmio de teste')`,
    )
    .run();
  return team!.id;
}

