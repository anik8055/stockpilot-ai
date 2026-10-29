/* Creates a local demo login with a synthetic workspace. Development use only.
 * Usage: npm run db:seed   (SEED_EMAIL / SEED_PASSWORD override the defaults) */
import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "yes") {
    throw new Error("Refusing to seed a production database. Set ALLOW_PROD_SEED=yes if you really mean it.");
  }
  const { withAdmin, closePools } = await import("@/lib/db");
  const { hashPassword } = await import("@/lib/auth/password");
  const { createDemoWorkspace } = await import("@/lib/services/demo");
  const email = process.env.SEED_EMAIL ?? "demo@stockpilot.local";
  const password = process.env.SEED_PASSWORD ?? "demo-password-2026";
  const hash = await hashPassword(password);
  const user = await withAdmin((tx) =>
    tx.one<{ id: string }>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Demo User', $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
      [email, hash],
    ),
  );
  const started = Date.now();
  const businessId = await createDemoWorkspace(user.id);
  console.log(`Demo workspace ${businessId} ready in ${Date.now() - started} ms.`);
  console.log(`Sign in with ${email} / ${password}  (synthetic data, local use only)`);
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
