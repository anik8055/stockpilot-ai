import { Client } from "pg";
import { runMigrations } from "@/lib/db/migrations";

/** Drops and recreates the test schema, then applies all migrations. Only ever run against the test database. */
export async function resetTestDatabase() {
  const url = process.env.DATABASE_ADMIN_URL!;
  if (!/stockpilot_test/.test(url)) throw new Error("Refusing to reset a database that is not stockpilot_test");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO stockpilot_app;");
  await c.end();
  await runMigrations(url);
}
