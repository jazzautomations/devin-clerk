import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seedDatabase } from "@/lib/seed";

// Camada de dados em Postgres. Mantém a forma do antigo better-sqlite3
// (`db.prepare(sql).get/all/run`, `db.exec`, `db.transaction`) só que
// assíncrona, pra o resto do app migrar trocando chamada por `await`.
// O SQL do app continua escrito no estilo que já existia; `toPostgres`
// traduz o pouco de dialeto SQLite que sobrou (placeholders, OR IGNORE,
// datetime('now'), LIKE) e cita identificadores camelCase.
//
// Driver: DATABASE_URL → node-postgres (staging/prod/e2e). Sem ela →
// PGlite em memória (Postgres real em WASM, um por processo — é o que os
// testes unitários usam, cada arquivo do vitest ganha banco limpo).

type Row = Record<string, unknown>;
type Param = unknown;
type QueryResult = { rows: Row[]; rowCount: number };

interface Executor {
  query(sql: string, params: Param[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
}

interface Driver extends Executor {
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export type RunResult = { changes: number; lastInsertRowid: number | undefined };

export interface Statement {
  get<T = Row>(...params: Param[]): Promise<T | undefined>;
  all<T = Row>(...params: Param[]): Promise<T[]>;
  run(...params: Param[]): Promise<RunResult>;
}

// ---------- tradução de dialeto ----------

// PK de cada tabela usada com INSERT OR REPLACE (vira ON CONFLICT … DO UPDATE)
const REPLACE_KEYS: Record<string, string[]> = {
  hackathons: ["id"],
  team_projects: ["teamId"],
  settings: ["key"],
};

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

export function toPostgres(
  sql: string,
  params: Param[],
): { text: string; values: Param[] } {
  // bind nomeado (@x, :x, $x) quando o único argumento é um objeto simples
  const named =
    params.length === 1 &&
    params[0] !== null &&
    typeof params[0] === "object" &&
    !Array.isArray(params[0]) &&
    !(params[0] instanceof Date);
  const bag = named ? (params[0] as Record<string, Param>) : null;
  const values: Param[] = [];
  const namedIndex = new Map<string, number>();
  let positional = 0;
  let out = "";

  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      // literal ou identificador já citado: copia até o fechamento ('' escapa)
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j === -1 ? sql.length : j;
      continue;
    }
    if (c === "?") {
      values.push(normalize(params[positional++]));
      out += `$${values.length}`;
      i++;
      continue;
    }
    if (
      bag &&
      (c === "@" || c === ":" || c === "$") &&
      /[A-Za-z_]/.test(sql[i + 1] ?? "") &&
      !(c === ":" && sql[i - 1] === ":")
    ) {
      IDENT.lastIndex = i + 1;
      const name = IDENT.exec(sql)![0];
      let idx = namedIndex.get(name);
      if (idx === undefined) {
        values.push(normalize(bag[name]));
        idx = values.length;
        namedIndex.set(name, idx);
      }
      out += `$${idx}`;
      i += 1 + name.length;
      continue;
    }
    if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
      IDENT.lastIndex = i;
      const word = IDENT.exec(sql)![0];
      // camelCase (tem minúscula e maiúscula) = identificador nosso → cita.
      // Palavra-chave SQL é toda maiúscula; função é toda minúscula.
      out += /[a-z]/.test(word) && /[A-Z]/.test(word) ? `"${word}"` : word;
      i += word.length;
      continue;
    }
    out += c;
    i++;
  }

  let text = out
    .replace(/datetime\(\s*'now'\s*\)/gi, "sqlite_now()")
    .replace(/datetime\(\s*'now'\s*,/gi, "sqlite_now(")
    .replace(/\bNOT\s+LIKE\b/g, "NOT ILIKE")
    .replace(/(?<!NOT )\bLIKE\b/g, "ILIKE");

  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i;
  const replace = /^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+("?)(\w+)\1\s*\(([^)]*)\)/i;
  const m = text.match(replace);
  if (m) {
    const table = m[2];
    const cols = m[3].split(",").map((s) => s.trim().replace(/"/g, ""));
    const keys = REPLACE_KEYS[table];
    if (!keys) throw new Error(`INSERT OR REPLACE sem chave conhecida: ${table}`);
    const set = cols
      .filter((col) => !keys.includes(col))
      .map((col) => `"${col}" = EXCLUDED."${col}"`)
      .join(", ");
    text = appendClause(
      text.replace(/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i, "INSERT INTO"),
      `ON CONFLICT (${keys.map((k) => `"${k}"`).join(", ")}) ` +
        (set ? `DO UPDATE SET ${set}` : "DO NOTHING"),
    );
  } else if (ignore.test(text)) {
    text = appendClause(text.replace(ignore, "INSERT INTO"), "ON CONFLICT DO NOTHING");
  }

  return { text, values };
}

function appendClause(sql: string, clause: string): string {
  const trimmed = sql.trim().replace(/;$/, "");
  const ret = trimmed.search(/\bRETURNING\b/i);
  return ret === -1
    ? `${trimmed} ${clause}`
    : `${trimmed.slice(0, ret)}${clause} ${trimmed.slice(ret)}`;
}

function normalize(v: Param): Param {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// ---------- drivers ----------

async function pgDriver(url: string): Promise<Driver> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  // COUNT/SUM voltam bigint/numeric; o app (e o SQLite) sempre tratou como number
  types.setTypeParser(20, (v: string) => Number(v));
  types.setTypeParser(1700, (v: string) => Number(v));
  // timeouts: banco pausado ou disco cheio não responde (não recusa), e sem
  // limite a request fica pendurada até o Caddy desistir; transação
  // esquecida seguraria lock pra sempre
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    connectionTimeoutMillis: 5_000,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000),
    idle_in_transaction_session_timeout: 30_000,
    application_name: process.env.DB_APP_NAME ?? "hackahub",
  });
  // erro num client ocioso (container do Postgres reiniciou) é emitido no
  // pool; sem listener ele derruba o processo inteiro
  pool.on("error", (e) => {
    console.error(JSON.stringify({ evt: "pg_pool_error", ts: new Date().toISOString(), msg: e.message }));
  });
  const wrap = (c: { query: typeof pool.query }): Executor => ({
    async query(sql, params) {
      const r = await c.query(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await c.query(sql);
    },
  });
  return {
    ...wrap(pool),
    close: () => pool.end(),
    async transaction(fn) {
      const client = await pool.connect();
      // conexão que falhou no ROLLBACK está morta: release(err) descarta em
      // vez de devolver ao pool pra próxima request herdar
      let broken: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client as never));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          broken = rollbackErr as Error;
        }
        throw e;
      } finally {
        client.release(broken);
      }
    },
  };
}

async function pgliteDriver(): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const parsers = {
    [types.INT8]: (v: string) => Number(v),
    [types.NUMERIC]: (v: string) => Number(v),
  };
  const lite = new PGlite({ parsers });
  type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>; exec: (s: string) => Promise<unknown> };
  const wrap = (c: Q): Executor => ({
    async query(sql, params) {
      const r = await c.query(sql, params as unknown[]);
      return { rows: r.rows as Row[], rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await c.exec(sql);
    },
  });
  return {
    ...wrap(lite as unknown as Q),
    transaction: (fn) => lite.transaction((tx) => fn(wrap(tx as unknown as Q))),
  };
}

// ---------- migrations + seed (uma vez por processo) ----------

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

async function migrate(d: Driver) {
  await d.transaction(async (tx) => {
    // trava entre processos (vários workers do build / instâncias subindo juntas)
    // migration grande ou espera pelo lock de outra instância não pode cair
    // no statement_timeout do pool
    await tx.exec("SET LOCAL statement_timeout = 0");
    await tx.query("SELECT pg_advisory_xact_lock(7262201)", []);
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const done = new Set(
      (await tx.query("SELECT name FROM schema_migrations", [])).rows.map(
        (r) => r.name as string,
      ),
    );
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await tx.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    }
  });
}

const g = globalThis as unknown as { __hackahubDb?: Promise<Driver> };

function driver(): Promise<Driver> {
  g.__hackahubDb ??= (async () => {
    const url = process.env.DATABASE_URL || undefined;
    const d = url ? await pgDriver(url) : await pgliteDriver();
    try {
      await migrate(d);
      await seedDatabase(makeApi(async () => d, new AsyncLocalStorage()));
    } catch (e) {
      await d.close?.().catch(() => {});
      throw e;
    }
    return d;
  })().catch((e) => {
    // boot com o Postgres ainda subindo (ECONNREFUSED): sem isso a promessa
    // rejeitada ficava guardada e o processo vivo devolvia 503 pra sempre;
    // a próxima chamada tenta de novo
    g.__hackahubDb = undefined;
    throw e;
  });
  return g.__hackahubDb;
}

// ---------- API pública ----------

const IDENTITY_TABLES = new Set([
  "members", "registrations", "subscribers", "posts", "teams", "edition_assets",
  "post_comments", "leads", "event_submissions", "notifications", "looking_for_team",
]);

function makeApi(getDriver: () => Promise<Driver>, als: AsyncLocalStorage<Executor>) {
  const executor = async (): Promise<Executor> => als.getStore() ?? (await getDriver());

  async function run(sql: string, params: Param[]): Promise<{ rows: Row[]; rowCount: number }> {
    const { text, values } = toPostgres(sql, params);
    const ex = await executor();
    const isInsert = /^\s*INSERT\b/i.test(text);
    const finalText = isInsert && !/\bRETURNING\b/i.test(text) ? `${text} RETURNING *` : text;
    const r = await ex.query(finalText, values);
    if (isInsert) await syncIdentity(ex, text);
    return r;
  }

  // INSERT com id explícito não avança a identity (o SQLite fazia max+1 sozinho)
  async function syncIdentity(ex: Executor, text: string) {
    const m = text.match(/^\s*INSERT\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)/i);
    if (!m || !IDENTITY_TABLES.has(m[1])) return;
    if (!m[2].split(",").some((c) => c.trim().replace(/"/g, "") === "id")) return;
    await ex.query(
      `SELECT setval(pg_get_serial_sequence('${m[1]}', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${m[1]}), 1))`,
      [],
    );
  }

  return {
    prepare(sql: string): Statement {
      return {
        async get<T>(...params: Param[]) {
          return (await run(sql, params)).rows[0] as T | undefined;
        },
        async all<T>(...params: Param[]) {
          return (await run(sql, params)).rows as T[];
        },
        async run(...params: Param[]) {
          const r = await run(sql, params);
          const id = r.rows[0]?.id;
          return {
            changes: r.rowCount,
            lastInsertRowid: typeof id === "number" ? id : undefined,
          };
        },
      };
    },
    async exec(sql: string) {
      await (await executor()).exec(toPostgres(sql, []).text);
    },
    // fn roda numa transação; chamadas a db.* dentro dela usam a mesma conexão
    transaction<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
      return async (...args: A): Promise<T> => {
        if (als.getStore()) return fn(...args);
        return (await getDriver()).transaction((tx) => als.run(tx, () => fn(...args)));
      };
    },
  };
}

export type Db = ReturnType<typeof makeApi>;

const db: Db = makeApi(driver, new AsyncLocalStorage());

export default db;
