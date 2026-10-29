import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { withAdmin } from "@/lib/db";
import { env, isProduction } from "@/lib/env";
import { hashToken, newToken } from "./tokens";

export const SESSION_COOKIE = isProductionCookie() ? "__Host-sp_session" : "sp_session";

function isProductionCookie() {
  return process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https://");
}

export type SessionUser = { id: string; email: string; name: string };
export type Session = { id: string; user: SessionUser; activeBusinessId: string | null };

export async function createSession(userId: string, activeBusinessId: string | null): Promise<void> {
  const token = newToken();
  const ttlDays = env().SESSION_TTL_DAYS;
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await withAdmin((tx) =>
    tx.query(
      `INSERT INTO sessions (user_id, token_hash, active_business_id, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [userId, hashToken(token), activeBusinessId, ua, ttlDays],
    ),
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction() || env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: ttlDays * 86400,
  });
}

/** Resolves the current session from the cookie. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await withAdmin((tx) =>
    tx.maybeOne<{ id: string; user_id: string; email: string; name: string; active_business_id: string | null; stale: boolean }>(
      `SELECT s.id, s.user_id, u.email, u.name, s.active_business_id,
              (s.last_seen_at < now() - interval '1 hour') AS stale
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [hashToken(token)],
    ),
  );
  if (!row) return null;
  if (row.stale) {
    await withAdmin((tx) => tx.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.id]));
  }
  return {
    id: row.id,
    user: { id: row.user_id, email: row.email, name: row.name },
    activeBusinessId: row.active_business_id,
  };
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await withAdmin((tx) => tx.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]));
  }
  jar.delete(SESSION_COOKIE);
}

export async function setActiveBusiness(sessionId: string, userId: string, businessId: string): Promise<boolean> {
  // Membership is verified in the same statement — a forged business ID simply matches nothing.
  const rows = await withAdmin((tx) =>
    tx.query(
      `UPDATE sessions s SET active_business_id = $3
        WHERE s.id = $1 AND s.user_id = $2
          AND EXISTS (SELECT 1 FROM memberships m JOIN businesses b ON b.id = m.business_id
                       WHERE m.user_id = $2 AND m.business_id = $3 AND b.deleted_at IS NULL)
        RETURNING s.id`,
      [sessionId, userId, businessId],
    ),
  );
  return rows.length === 1;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim().slice(0, 64);
}
