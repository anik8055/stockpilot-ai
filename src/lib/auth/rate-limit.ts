import "server-only";
import { withAdmin } from "@/lib/db";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests. Please wait and try again.");
  }
}

/**
 * Fixed-window counter stored in Postgres (works on serverless without Redis).
 * Returns remaining count; throws RateLimitError when exceeded.
 */
export async function rateLimit(key: string, baseLimit: number, windowSeconds: number): Promise<number> {
  // Development and automated test servers hit the same endpoints many times from one IP. RATE_LIMIT_RELAXED must
  // never be set on a real deployment; production keeps the real limits.
  const relaxed = (process.env.NODE_ENV !== "production" && process.env.RATE_LIMIT_STRICT !== "1") || process.env.RATE_LIMIT_RELAXED === "1";
  const limit = relaxed ? baseLimit * 50 : baseLimit;
  const row = await withAdmin((tx) =>
    tx.one<{ count: number; window_start: Date }>(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
       RETURNING count, window_start`,
      [key, windowSeconds],
    ),
  );
  if (row.count > limit) {
    const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
    throw new RateLimitError(Math.max(1, Math.ceil(windowSeconds - elapsed)));
  }
  return limit - row.count;
}
