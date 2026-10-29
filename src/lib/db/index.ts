import "server-only";
import { Pool, type PoolClient, type QueryResultRow, types } from "pg";
import { env } from "@/lib/env";

// numeric/bigint come back as strings by default; keep numeric as string (decimal-safe) but parse bigint ids.
types.setTypeParser(20, (v) => Number(v)); // int8
types.setTypeParser(1082, (v) => v); // date → 'YYYY-MM-DD' string, no timezone shifting

declare global {
  // eslint-disable-next-line no-var
  var __stockpilotPools: { app?: Pool; admin?: Pool } | undefined;
}

const pools = (globalThis.__stockpilotPools ??= {});

function appPool(): Pool {
  return (pools.app ??= new Pool({
    connectionString: env().DATABASE_URL,
    max: env().DATABASE_POOL_MAX,
    idleTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  }));
}

/** Owner connection. Bypasses RLS — use only for identity tables, workspace creation, rate limits and seeding. */
function adminPool(): Pool {
  return (pools.admin ??= new Pool({
    connectionString: env().DATABASE_ADMIN_URL,
    max: Math.max(2, Math.ceil(env().DATABASE_POOL_MAX / 2)),
    idleTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  }));
}

export type Tx = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R>;
  maybeOne<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R | null>;
  raw: PoolClient;
};

function wrap(client: PoolClient): Tx {
  return {
    raw: client,
    async query(text, params) {
      const res = await client.query(text, params as unknown[]);
      return res.rows;
    },
    async one(text, params) {
      const res = await client.query(text, params as unknown[]);
      if (res.rows.length !== 1) throw new Error(`Expected exactly one row, got ${res.rows.length}`);
      return res.rows[0];
    },
    async maybeOne(text, params) {
      const res = await client.query(text, params as unknown[]);
      return res.rows[0] ?? null;
    },
  };
}

async function inTransaction<T>(pool: Pool, setup: (c: PoolClient) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setup(client);
    const result = await fn(wrap(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export type TenantDbContext = { userId: string; businessId: string };

/**
 * Runs fn in a transaction as the RLS-restricted app role with the tenant context set.
 * Callers must obtain ctx from requireTenant(), which verifies membership server-side.
 */
export function withTenant<T>(ctx: TenantDbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(
    appPool(),
    async (c) => {
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.business_id', $2, true)", [
        ctx.userId,
        ctx.businessId,
      ]);
    },
    fn,
  );
}

/** App role with only a user context (no business) — e.g. listing the user's own workspaces. */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(
    appPool(),
    async (c) => {
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.business_id', '', true)", [userId]);
    },
    fn,
  );
}

/** Owner role transaction. Restricted to src/lib/auth, workspace provisioning, rate limits and scripts. */
export function withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(adminPool(), async () => undefined, fn);
}

export async function closePools() {
  await Promise.all([pools.app?.end(), pools.admin?.end()]);
  pools.app = undefined;
  pools.admin = undefined;
}

export async function dbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await appPool().query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "unknown" };
  }
}
