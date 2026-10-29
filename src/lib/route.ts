import "server-only";
import { NextResponse } from "next/server";
import type { Permission } from "@/lib/auth/permissions";
import { AppError, logError, publicMessage } from "@/lib/errors";
import { RateLimitError } from "@/lib/auth/rate-limit";
import { tenantOrNull, type TenantContext } from "@/lib/tenant";

/** Wraps a route handler: resolves the tenant server-side, checks permission, maps errors to safe JSON. */
export async function withRoute(permission: Permission, scope: string, fn: (t: TenantContext) => Promise<Response>): Promise<Response> {
  try {
    const t = await tenantOrNull(permission);
    if (t === null) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    if (t === "forbidden") return NextResponse.json({ error: "You do not have permission to do that." }, { status: 403 });
    return await fn(t);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
    }
    if (err instanceof AppError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    logError(scope, err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export function fileResponse(body: string | Buffer, filename: string, contentType: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
