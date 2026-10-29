import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { businessSettingsSchema, parseBusinessSettings } from "@/lib/domain/settings";

type Ctx = { userId: string; businessId: string };

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(160),
  legal_name: opt(200),
  industry: z.enum(["hardware", "electrical", "auto_parts", "wholesale", "distribution", "general"]),
  gstin: z.string().trim().toUpperCase().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^[0-9]{2}[A-Z0-9]{13}$/.test(v), "GSTIN should be 15 characters"),
  address_line1: opt(200),
  address_line2: opt(200),
  city: opt(80),
  state: opt(80),
  pincode: z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{6}$/.test(v), "PIN code should be 6 digits"),
  phone: opt(30),
  email: z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email"),
});

export async function getProfile(db: Tx, businessId: string) {
  return db.one<Record<string, string | null> & { join_code: string | null; settings: unknown }>(
    "SELECT name, legal_name, industry, gstin, address_line1, address_line2, city, state, pincode, phone, email, join_code, settings FROM businesses WHERE id = $1",
    [businessId],
  );
}

export async function updateProfile(db: Tx, ctx: Ctx, input: unknown) {
  const d = profileSchema.parse(input);
  await db.query(
    `UPDATE businesses SET name=$2, legal_name=$3, industry=$4, gstin=$5, address_line1=$6, address_line2=$7, city=$8, state=$9, pincode=$10, phone=$11, email=$12, updated_at=now() WHERE id=$1`,
    [ctx.businessId, d.name, d.legal_name, d.industry, d.gstin, d.address_line1, d.address_line2, d.city, d.state, d.pincode, d.phone, d.email],
  );
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id) VALUES ($1,$2,'business.updated','business',$3)", [ctx.businessId, ctx.userId, ctx.businessId]);
}

const intField = (min: number, max: number, label: string) => z.coerce.number({ message: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);

export const analysisFormSchema = z.object({
  demandLookbackDays: intField(14, 365, "Demand window"),
  minHistoryDays: intField(7, 180, "Minimum history"),
  targetCoverageDays: intField(1, 180, "Cover target"),
  defaultLeadTimeDays: intField(0, 180, "Default lead time"),
  defaultSafetyDays: z.coerce.number().min(0).max(60),
  slowMovingDays: z.coerce.number().refine((v) => [30, 60, 90, 180].includes(v), "Choose 30, 60, 90 or 180 days"),
  slowVelocityPerMonth: z.coerce.number().min(0).max(1_000_000),
  excessCoverageDays: intField(30, 730, "Excess limit"),
  useTrendAdjustment: z.boolean(),
});

export async function updateAnalysisSettings(db: Tx, ctx: Ctx, input: unknown) {
  const analysis = analysisFormSchema.parse(input);
  const current = parseBusinessSettings((await db.one<{ settings: unknown }>("SELECT settings FROM businesses WHERE id = $1", [ctx.businessId])).settings);
  const next = businessSettingsSchema.parse({ ...current, analysis });
  await db.query("UPDATE businesses SET settings = $2, updated_at = now() WHERE id = $1", [ctx.businessId, JSON.stringify(next)]);
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'settings.analysis_updated','business',$3,$4)", [
    ctx.businessId, ctx.userId, ctx.businessId, JSON.stringify(analysis),
  ]);
}

export async function listMembers(db: Tx) {
  return db.query<{ user_id: string; name: string; email: string; role: "owner" | "admin" | "staff"; joined_at: Date }>("SELECT * FROM app.business_members()");
}

export async function recentAudit(db: Tx, businessId: string, limit = 30) {
  return db.query<{ id: number; action: string; entity_type: string | null; created_at: Date; actor: string | null; metadata: Record<string, unknown> }>(
    `SELECT a.id, a.action, a.entity_type, a.created_at, m.name AS actor, a.metadata
       FROM audit_events a LEFT JOIN app.business_members() m ON m.user_id = a.actor_user_id
      WHERE a.business_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
    [businessId, limit],
  );
}
