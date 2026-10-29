/* Applies db/migrations/*.sql in order using the owner connection (DATABASE_ADMIN_URL).
 * Each file runs in its own transaction and is recorded with a checksum; changed files are refused. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is required to run migrations");
  const client = new Client({ connectionString: url }); // TLS via ?sslmode=... in the URL
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    let count = 0;
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prev = applied.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${file} changed after being applied. Create a new migration instead.`);
        continue;
      }
      process.stdout.write(`applying ${file} ... `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
        count++;
        console.log("ok");
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw err;
      }
    }
    console.log(count ? `${count} migration(s) applied.` : "Database is up to date.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
