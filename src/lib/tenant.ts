import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { getSession, setActiveBusiness, type SessionUser } from "@/lib/auth/session";
import { withAdmin, withTenant, type Tx } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { parseBusinessSettings, type BusinessSettings } from "@/lib/domain/settings";

export type BusinessSummary = {
  id: string;
  name: string;
  industry: string;
  currency: string;
  timezone: string;
  isDemo: boolean;
  planCode: string;
  planStatus: string;
  trialEndsAt: string | null;
  settings: BusinessSettings;
};

export type TenantContext = {
  sessionId: string;
  user: SessionUser;
  userId: string;
  businessId: string;
  role: Role;
  business: BusinessSummary;
};

/** Resolves user + verified membership for the session's active business. Null when not signed in / no workspace. */
export const getTenant = cache(async (): Promise<TenantContext | null> => {
  const session = await getSession();
  if (!session) return null;

  let businessId = session.activeBusinessId;
  let membership = businessId ? await membershipRole(session.user.id, businessId) : null;
  if (!membership) {
    // Fall back to the user's first workspace (and remember it).
    const first = await withAdmin((tx) =>
      tx.maybeOne<{ business_id: string }>(
        `SELECT m.business_id FROM memberships m JOIN businesses b ON b.id = m.business_id
          WHERE m.user_id = $1 AND b.deleted_at IS NULL ORDER BY b.is_demo, m.created_at LIMIT 1`,
        [session.user.id],
      ),
    );
    if (!first) return null;
    businessId = first.business_id;
    await setActiveBusiness(session.id, session.user.id, businessId);
    membership = await membershipRole(session.user.id, businessId);
    if (!membership) return null;
  }

  const ctx = { userId: session.user.id, businessId: businessId! };
  const b = await withTenant(ctx, (tx) =>
    tx.one<{
      id: string; name: string; industry: string; currency: string; timezone: string; is_demo: boolean;
      plan_code: string; plan_status: string; trial_ends_at: Date | null; settings: unknown;
    }>(
      `SELECT id, name, industry, currency, timezone, is_demo, plan_code, plan_status, trial_ends_at, settings
         FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
      [businessId],
    ),
  );

  return {
    sessionId: session.id,
    user: session.user,
    userId: session.user.id,
    businessId: b.id,
    role: membership,
    business: {
      id: b.id,
      name: b.name,
      industry: b.industry,
      currency: b.currency,
      timezone: b.timezone,
      isDemo: b.is_demo,
      planCode: b.plan_code,
      planStatus: b.plan_status,
      trialEndsAt: b.trial_ends_at ? new Date(b.trial_ends_at).toISOString() : null,
      settings: parseBusinessSettings(b.settings),
    },
  };
});

async function membershipRole(userId: string, businessId: string): Promise<Role | null> {
  const row = await withAdmin((tx) =>
    tx.maybeOne<{ role: Role }>(
      `SELECT m.role FROM memberships m JOIN businesses b ON b.id = m.business_id
        WHERE m.user_id = $1 AND m.business_id = $2 AND b.deleted_at IS NULL`,
      [userId, businessId],
    ),
  );
  return row?.role ?? null;
}

/** For pages and server actions: redirects when unauthenticated, throws ForbiddenError when lacking permission. */
export async function requireTenant(permission: Permission = "view"): Promise<TenantContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  const tenant = await getTenant();
  if (!tenant) redirect("/onboarding");
  if (!can(tenant.role, permission)) throw new ForbiddenError();
  return tenant;
}

/** For route handlers: returns null instead of redirecting. */
export async function tenantOrNull(permission: Permission = "view"): Promise<TenantContext | "forbidden" | null> {
  const tenant = await getTenant();
  if (!tenant) return null;
  if (!can(tenant.role, permission)) return "forbidden";
  return tenant;
}

export function tx<T>(t: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant({ userId: t.userId, businessId: t.businessId }, fn);
}

export async function audit(
  db: Tx,
  t: Pick<TenantContext, "businessId" | "userId">,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [t.businessId, t.userId, action, entityType ?? null, entityId ?? null, JSON.stringify(metadata)],
  );
}
