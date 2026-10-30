import "server-only";
import { Pool, type PoolClient, type QueryResultRow, types } from "pg";
import { env } from "@/lib/env";
import { pgConnectionConfig } from "../../../db/pg-config.mjs";

// numeric/bigint come back as strings by default; keep numeric as string (decimal-safe) but parse bigint ids.
types.setTypeParser(20, (v) => Number(v)); // int8
types.setTypeParser(1082, (v) => v); // date → 'YYYY-MM-DD' string, no timezone shifting

declare global {
  var __stockpilotPools: { app?: Pool; admin?: Pool } | undefined;
}

const pools = (globalThis.__stockpilotPools ??= {});

function appPool(): Pool {
  return (pools.app ??= new Pool({
    ...pgConnectionConfig(env().DATABASE_URL, env().DATABASE_CA_CERT),
    max: env().DATABASE_POOL_MAX,
    idleTimeoutMillis: 10_000,
    ...statementTimeout(),
  }));
}

/** Per-statement timeout sent at connect time; DATABASE_STATEMENT_TIMEOUT_MS=0 omits it (for poolers that reject it). */
function statementTimeout() {
  const ms = env().DATABASE_STATEMENT_TIMEOUT_MS;
  return ms > 0 ? { statement_timeout: ms } : {};
}

/** Owner connection. Bypasses RLS — use only for identity tables, workspace creation, rate limits and seeding. */
function adminPool(): Pool {
  return (pools.admin ??= new Pool({
    ...pgConnectionConfig(env().DATABASE_ADMIN_URL, env().DATABASE_CA_CERT),
    max: Math.max(2, Math.ceil(env().DATABASE_POOL_MAX / 2)),
    idleTimeoutMillis: 10_000,
    ...statementTimeout(),
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

/** Must match the newest file in db/migrations (checked by tests/unit/db-diagnostics.test.ts). */
export const LATEST_MIGRATION = "0006_scheduled_reports.sql";

export type DbCheck = { ok: boolean; latencyMs: number; problem?: string; hint?: string };

/** Maps a connection/query error to a short, secret-free problem code and fix hint for the health endpoint. */
export function classifyDbError(err: unknown): { problem: string; hint: string } {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  const msg = String(e?.message ?? "");
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|CERT_/.test(code) || /self[- ]signed certificate|unable to verify/i.test(msg))
    return { problem: "tls_certificate_not_trusted", hint: "Set DATABASE_CA_CERT to your database provider's CA certificate (Supabase: Database settings → SSL configuration → download certificate)." };
  if (/Tenant or user not found/i.test(msg))
    return { problem: "pooler_user_not_found", hint: "With the Supabase pooler the username must be '<role>.<project-ref>', e.g. stockpilot_app.abcdefgh." };
  if (code === "28P01") return { problem: "wrong_password", hint: "The password in the database URL is wrong (URL-encode special characters)." };
  if (code === "28000") return { problem: "login_rejected", hint: "The database rejected this role. Check the role exists and can log in." };
  if (code === "3D000") return { problem: "database_not_found", hint: "The database name in the URL does not exist (Supabase uses 'postgres')." };
  if (code === "42P01") return { problem: "tables_missing", hint: "Run the migrations: DATABASE_ADMIN_URL=… npm run db:migrate" };
  if (code === "42501") return { problem: "permission_denied", hint: "The app role lacks grants. Run migrations as the owner after creating stockpilot_app." };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { problem: "host_not_found", hint: "The database host name in the URL is wrong." };
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout/i.test(msg)) return { problem: "unreachable", hint: "The database did not answer. Check host, port and that the project is not paused." };
  if (/startup parameter/i.test(msg)) return { problem: "pooler_parameter_rejected", hint: "The connection pooler rejected a session setting; set DATABASE_STATEMENT_TIMEOUT_MS=0." };
  if (/invalid url|connection string/i.test(msg)) return { problem: "invalid_url", hint: "The database URL is not a valid postgres:// URL." };
  return { problem: code ? `error_${code}` : "unknown_error", hint: "See the server logs for details." };
}

async function check(pool: () => Pool, sql: string): Promise<DbCheck & { row?: QueryResultRow }> {
  const start = Date.now();
  try {
    const r = await pool().query(sql);
    return { ok: true, latencyMs: Date.now() - start, row: r.rows[0] };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, ...classifyDbError(err) };
  }
}

export async function dbHealth(): Promise<DbCheck> {
  const { row: _row, ...r } = await check(appPool, "SELECT 1");
  void _row;
  return r;
}

/** App + owner connections, role safety and migration state — no secrets. */
export async function dbDiagnostics() {
  const app = await check(appPool, "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
  const admin = await check(adminPool, "SELECT count(*)::int AS applied, max(name) AS latest FROM schema_migrations");
  return {
    app: { ok: app.ok, latencyMs: app.latencyMs, problem: app.problem, hint: app.hint, rlsEnforced: app.row ? !app.row.rolsuper && !app.row.rolbypassrls : undefined },
    admin: { ok: admin.ok, problem: admin.problem, hint: admin.hint, migrationsApplied: admin.row?.applied as number | undefined, latestMigration: admin.row?.latest as string | undefined },
  };
}
