import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logError } from "@/lib/errors";
import { runWeeklyReports } from "@/lib/services/scheduled-reports";

export const maxDuration = 300;

/**
 * Called by a scheduler every Monday morning (Vercel Cron via vercel.json, or system cron / any HTTP scheduler on
 * other hosts) with `Authorization: Bearer $CRON_SECRET`. Disabled (404) when CRON_SECRET is not set.
 */
async function handle(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not found" }, { status: 404 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const results = await runWeeklyReports();
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return NextResponse.json({ workspaces: results.length, sent: count("sent"), alreadyDone: count("already_done"), failed: count("failed") });
  } catch (err) {
    logError("cron.weekly_reports", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
