// Server-only Amazon Aurora PostgreSQL data layer. This is the single place the
// app talks to its database. DATABASE_URL points at the Aurora cluster endpoint;
// it is read server-side only and never reaches the browser (.server.ts).
//
// On Vercel the pool is kept warm per function instance across invocations. For
// very high concurrency put Amazon RDS Proxy in front (set DATABASE_URL to the
// proxy endpoint) — no code change needed.
import { Pool, type PoolClient } from "pg";

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? process.env.AURORA_DATABASE_URL ?? "";
}

export function isAuroraConfigured(): boolean {
  return databaseUrl().length > 0;
}

let _pool: Pool | null = null;
export function pool(): Pool {
  if (!isAuroraConfigured()) {
    throw new Error("DATABASE_URL is not set — point it at your Aurora PostgreSQL endpoint.");
  }
  if (!_pool) {
    _pool = new Pool({
      connectionString: databaseUrl(),
      // Aurora requires TLS. We don't pin the RDS CA here for portability; set
      // PGSSL=disable only for a local non-TLS Postgres.
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    _pool.on("error", (err) => console.error("[aurora] idle client error", err));
  }
  return _pool;
}

// JSON-serializable value/row types. Server functions require serializable
// return types; `unknown`-valued records fail that check, so DB reads are typed
// as DbRow. (Postgres Date columns serialize to ISO strings over the RPC, which
// matches the app's string date fields.)
export type DbValue = string | number | boolean | null | DbValue[] | { [k: string]: DbValue };
export type DbRow = { [k: string]: DbValue };

export interface QueryResultLike<T> {
  rows: T[];
  rowCount: number;
}

// Parameterized query helper. Always use $1, $2… placeholders — never string
// interpolation — so the data layer is injection-safe by construction.
export async function query<T = DbRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResultLike<T>> {
  const res = await pool().query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export async function queryRows<T = DbRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await query<T>(text, params)).rows;
}

export async function queryOne<T = DbRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T>(text, params);
  return rows[0] ?? null;
}

// Run a set of statements in a single transaction (used for multi-step writes
// like creating a dataset + its rows).
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw e;
  } finally {
    client.release();
  }
}

// Live connectivity probe for the health/diagnostic surface.
export async function pingAurora(): Promise<
  { ok: true; latencyMs: number; version: string } | { ok: false; message: string }
> {
  if (!isAuroraConfigured()) return { ok: false, message: "DATABASE_URL is not set." };
  const t0 = Date.now();
  try {
    const row = await queryOne<{ version: string }>("select version() as version");
    return { ok: true, latencyMs: Date.now() - t0, version: (row?.version ?? "").split(" ").slice(0, 2).join(" ") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
