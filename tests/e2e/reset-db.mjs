// pretest:e2e — zera o banco dedicado do e2e antes do build, pra cada rodada
// começar só com migrations + seed de base (aplicados no boot do server).
// Recusa rodar contra banco que não seja de e2e.
import pg from "pg";

const url = process.env.E2E_DATABASE_URL;
if (!url || !/e2e/.test(new URL(url).pathname)) {
  console.error("E2E_DATABASE_URL ausente ou não aponta pra um banco *e2e*");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await client.end();
