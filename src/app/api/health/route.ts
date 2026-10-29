import { NextResponse } from "next/server";
import { dbHealth } from "@/lib/db";
import { aiStatus } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/** Liveness + dependency check. Reports configuration state only — never secrets. */
export async function GET(req: Request) {
  const db = await dbHealth();
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const ai = await aiStatus(deep);
  const body = {
    status: db.ok ? "ok" : "degraded",
    database: db.ok ? { ok: true, latencyMs: db.latencyMs } : { ok: false },
    ai,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
