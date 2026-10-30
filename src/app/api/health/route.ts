import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/provider";
import { dbDiagnostics, LATEST_MIGRATION } from "@/lib/db";
import { envProblems } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness + setup check. Reports configuration state, problem codes and fix hints — never secrets or raw errors.
 * Open it in a browser after deploying: every "problem" comes with a "hint".
 */
export async function GET(req: Request) {
  const missing = envProblems();
  if (missing.length) {
    return NextResponse.json(
      { status: "misconfigured", config: { ok: false, missingOrInvalid: missing, hint: "Set these environment variables in your host (e.g. Vercel → Settings → Environment Variables) and redeploy." }, time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const db = await dbDiagnostics();
  const warnings: string[] = [];
  if (process.env.NODE_ENV === "production" && !/^https:\/\//.test(process.env.APP_URL ?? "")) warnings.push("APP_URL should be your https:// address in production (secure cookies, email links).");
  if (process.env.VERCEL && (process.env.STORAGE_DRIVER ?? "local") === "local") warnings.push("File storage is set to local disk, which Vercel does not keep. Set STORAGE_DRIVER=s3 and the S3_* variables (e.g. a private Supabase Storage bucket) so imports and invoices can be uploaded.");
  if (db.app.ok && db.app.rlsEnforced === false) warnings.push("DATABASE_URL connects as a superuser/BYPASSRLS role — tenant isolation is not enforced. Use the stockpilot_app role.");
  const migrationsOk = db.admin.ok && db.admin.latestMigration === LATEST_MIGRATION;
  if (db.admin.ok && !migrationsOk) warnings.push(`Migrations are not up to date (database has ${db.admin.latestMigration ?? "none"}, app needs ${LATEST_MIGRATION}). Run npm run db:migrate with DATABASE_ADMIN_URL.`);

  // The deep check calls the AI provider; allow it only with the configured token (or outside production).
  const token = process.env.HEALTH_CHECK_TOKEN;
  const wantsDeep = new URL(req.url).searchParams.get("deep") === "1";
  const deep = wantsDeep && (process.env.NODE_ENV !== "production" || (!!token && req.headers.get("x-health-token") === token));
  const ai = await aiStatus(deep);

  const ok = db.app.ok && db.admin.ok && migrationsOk;
  const body = {
    status: ok ? "ok" : "degraded",
    database: { ok: db.app.ok, latencyMs: db.app.ok ? db.app.latencyMs : undefined, problem: db.app.problem, hint: db.app.hint },
    adminDatabase: { ok: db.admin.ok, problem: db.admin.problem, hint: db.admin.hint },
    migrations: { ok: migrationsOk, latest: db.admin.latestMigration ?? null, expected: LATEST_MIGRATION },
    warnings,
    ai,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
