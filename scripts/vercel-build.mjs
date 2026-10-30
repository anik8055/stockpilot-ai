// Vercel runs `npm run vercel-build` instead of `npm run build` when this script exists.
// Production deploys apply pending database migrations first (so no one has to run them by hand); preview deploys
// never touch the database. A failed migration fails the deploy, leaving the previous version live.
import { spawnSync } from "node:child_process";
import { runMigrations } from "../db/migrate.mjs";

const env = process.env.VERCEL_ENV;
if (env === "production" && process.env.DATABASE_ADMIN_URL) {
  console.log("Applying database migrations…");
  try {
    const n = await runMigrations(process.env.DATABASE_ADMIN_URL, (m) => console.log(`  ${m}`));
    console.log(n ? `${n} migration(s) applied.` : "Database is up to date.");
  } catch (err) {
    // Message only — never the connection string.
    console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
} else {
  console.log(`Skipping migrations (VERCEL_ENV=${env ?? "unset"}${process.env.DATABASE_ADMIN_URL ? "" : ", DATABASE_ADMIN_URL not set"}).`);
}

const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
