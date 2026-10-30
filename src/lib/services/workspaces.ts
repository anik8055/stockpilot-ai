import "server-only";
import { cancelSubscriptionsForDeletion } from "@/lib/services/billing";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withAdmin, withTenant, withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, ForbiddenError, LimitError } from "@/lib/errors";
import type { Role } from "@/lib/auth/permissions";
import { storage } from "@/lib/storage";

export const INDUSTRIES = [
  { value: "electrical", label: "Electrical supplies" },
  { value: "hardware", label: "Hardware & tools" },
  { value: "auto_parts", label: "Automobile spare parts" },
  { value: "wholesale", label: "Wholesale trading" },
  { value: "distribution", label: "Distribution" },
  { value: "general", label: "Other" },
] as const;

export const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(160),
  industry: z.enum(["hardware", "electrical", "auto_parts", "wholesale", "distribution", "general"]),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  state: z.string().trim().max(80).optional().transform((v) => v || null),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[0-9]{2}[A-Z0-9]{13}$/.test(v), "GSTIN should be 15 characters, e.g. 27ABCDE1234F1Z5"),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
});

function joinCode() {
  // 10 chars from an unambiguous alphabet
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createBusiness(userId: string, input: z.input<typeof businessSchema>): Promise<{ id: string }> {
  const data = businessSchema.parse(input);
  return withAdmin(async (tx) => {
    const owned = await tx.one<{ count: number; allowed: number | null }>(
      `SELECT count(*)::int AS count, max((p.limits->>'max_workspaces_per_owner')::int) AS allowed
         FROM memberships m JOIN businesses b ON b.id = m.business_id JOIN plans p ON p.code = b.plan_code
        WHERE m.user_id = $1 AND m.role = 'owner' AND NOT b.is_demo AND b.deleted_at IS NULL`,
      [userId],
    );
    const allowed = owned.allowed ?? 1;
    if (owned.count >= Math.max(1, allowed)) {
      throw new LimitError(`Your current plan allows ${allowed} business workspace${allowed === 1 ? "" : "s"}. Upgrade to add another.`);
    }
    const b = await tx.one<{ id: string }>(
      `INSERT INTO businesses (name, industry, city, state, gstin, phone, plan_code, plan_status, trial_ends_at, join_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'trial', 'trialing', now() + make_interval(days => $7), $8, $9) RETURNING id`,
      [data.name, data.industry, data.city, data.state, data.gstin, data.phone, env().TRIAL_DAYS, joinCode(), userId],
    );
    await tx.query("INSERT INTO memberships (business_id, user_id, role) VALUES ($1, $2, 'owner')", [b.id, userId]);
    await tx.query(
      "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'business.created', 'business', $3)",
      [b.id, userId, b.id],
    );
    return b;
  });
}

export async function joinBusinessByCode(userId: string, rawCode: string): Promise<{ id: string; name: string }> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 10) throw new AppError("Join codes are 10 characters. Ask the workspace owner for the code in Settings → Team.");
  return withAdmin(async (tx) => {
    const b = await tx.maybeOne<{ id: string; name: string; max_members: number }>(
      `SELECT b.id, b.name, (p.limits->>'max_members')::int AS max_members
         FROM businesses b JOIN plans p ON p.code = b.plan_code
        WHERE b.join_code = $1 AND b.deleted_at IS NULL AND NOT b.is_demo FOR UPDATE OF b`,
      [code],
    );
    if (!b) throw new AppError("That join code is not valid. Check it with the workspace owner.", 404, "bad_code");
    const existing = await tx.maybeOne("SELECT 1 FROM memberships WHERE business_id = $1 AND user_id = $2", [b.id, userId]);
    if (existing) return { id: b.id, name: b.name };
    const { count } = await tx.one<{ count: number }>("SELECT count(*)::int AS count FROM memberships WHERE business_id = $1", [b.id]);
    if (count >= b.max_members) throw new LimitError(`${b.name} has reached its plan limit of ${b.max_members} team members.`);
    await tx.query("INSERT INTO memberships (business_id, user_id, role) VALUES ($1, $2, 'staff')", [b.id, userId]);
    await tx.query(
      "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'member.joined', 'user', $3)",
      [b.id, userId, userId],
    );
    return { id: b.id, name: b.name };
  });
}

export type WorkspaceListItem = { id: string; name: string; role: Role; isDemo: boolean; planCode: string };

export async function listWorkspaces(userId: string): Promise<WorkspaceListItem[]> {
  const rows = await withUser(userId, (tx) =>
    tx.query<{ id: string; name: string; role: Role; is_demo: boolean; plan_code: string }>(
      `SELECT b.id, b.name, m.role, b.is_demo, b.plan_code
         FROM businesses b JOIN memberships m ON m.business_id = b.id AND m.user_id = app.current_user_id()
        WHERE b.deleted_at IS NULL ORDER BY b.is_demo, b.name`,
    ),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, isDemo: r.is_demo, planCode: r.plan_code }));
}

export async function regenerateJoinCode(ctx: { userId: string; businessId: string; role: Role }): Promise<string> {
  if (ctx.role === "staff") throw new ForbiddenError();
  const code = joinCode();
  await withTenant(ctx, (tx) => tx.query("UPDATE businesses SET join_code = $1, updated_at = now() WHERE id = $2", [code, ctx.businessId]));
  return code;
}

export async function updateMemberRole(ctx: { userId: string; businessId: string; role: Role }, memberId: string, role: Role) {
  if (ctx.role === "staff") throw new ForbiddenError();
  if (role === "owner" && ctx.role !== "owner") throw new ForbiddenError("Only an owner can make someone an owner.");
  await withTenant(ctx, async (tx) => {
    const target = await tx.maybeOne<{ role: Role }>("SELECT role FROM memberships WHERE business_id = $1 AND user_id = $2", [ctx.businessId, memberId]);
    if (!target) throw new AppError("Member not found.", 404);
    if (target.role === "owner" && ctx.role !== "owner") throw new ForbiddenError("Only an owner can change another owner.");
    if (target.role === "owner" && role !== "owner") {
      const { count } = await tx.one<{ count: number }>("SELECT count(*)::int AS count FROM memberships WHERE business_id = $1 AND role = 'owner'", [ctx.businessId]);
      if (count <= 1) throw new AppError("A workspace needs at least one owner.");
    }
    await tx.query("UPDATE memberships SET role = $1 WHERE business_id = $2 AND user_id = $3", [role, ctx.businessId, memberId]);
    await tx.query(
      "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'member.role_changed', 'user', $3, $4)",
      [ctx.businessId, ctx.userId, memberId, JSON.stringify({ role })],
    );
  });
}

export async function removeMember(ctx: { userId: string; businessId: string; role: Role }, memberId: string) {
  if (ctx.role === "staff" && memberId !== ctx.userId) throw new ForbiddenError();
  await withTenant(ctx, async (tx) => {
    const target = await tx.maybeOne<{ role: Role }>("SELECT role FROM memberships WHERE business_id = $1 AND user_id = $2", [ctx.businessId, memberId]);
    if (!target) throw new AppError("Member not found.", 404);
    if (target.role === "owner") {
      if (ctx.role !== "owner") throw new ForbiddenError("Only an owner can remove an owner.");
      const { count } = await tx.one<{ count: number }>("SELECT count(*)::int AS count FROM memberships WHERE business_id = $1 AND role = 'owner'", [ctx.businessId]);
      if (count <= 1) throw new AppError("A workspace needs at least one owner. Transfer ownership first.");
    }
    await tx.query("DELETE FROM memberships WHERE business_id = $1 AND user_id = $2", [ctx.businessId, memberId]);
    await tx.query(
      "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id) VALUES ($1, $2, 'member.removed', 'user', $3)",
      [ctx.businessId, ctx.userId, memberId],
    );
  });
}

/** Permanently deletes a workspace and all of its data. Owner only; caller re-verifies the password. */
export async function deleteBusiness(ctx: { userId: string; businessId: string; role: Role }) {
  if (ctx.role !== "owner") throw new ForbiddenError("Only an owner can delete the workspace.");
  await cancelSubscriptionsForDeletion([ctx.businessId]);
  await withAdmin(async (tx) => {
    const ok = await tx.maybeOne("SELECT 1 FROM memberships WHERE business_id = $1 AND user_id = $2 AND role = 'owner'", [ctx.businessId, ctx.userId]);
    if (!ok) throw new ForbiddenError();
    await tx.query("DELETE FROM businesses WHERE id = $1", [ctx.businessId]);
  });
  await storage().removePrefix(`${ctx.businessId}/`);
}
