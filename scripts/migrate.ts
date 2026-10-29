/* Applies pending migrations using DATABASE_ADMIN_URL (the schema-owner role). */
import { runMigrations } from "../src/lib/db/migrations";
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("DATABASE_ADMIN_URL is required to run migrations");
  process.exit(1);
}
runMigrations(url, console.log)
  .then((n) => console.log(n ? `${n} migration(s) applied.` : "Database is up to date."))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
