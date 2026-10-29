import "server-only";
import type { Tx } from "@/lib/db";
import { LimitError } from "@/lib/errors";

export type PlanLimits = {
  max_products: number;
  max_members: number;
  max_workspaces_per_owner: number;
  imports_per_month: number;
  ai_requests_per_month: number;
  invoice_extractions_per_month: number;
};
export type PlanFeatures = {
  reorder_engine: boolean;
  supplier_analysis: boolean;
  assistant: boolean;
  invoice_extraction: boolean;
  advanced_reports: boolean;
};
export type Plan = {
  code: string;
  name: string;
  priceInrMonthly: string | null;
  isCustomPrice: boolean;
  description: string;
  limits: PlanLimits;
  features: PlanFeatures;
};

export type Entitlements = {
  plan: Plan;
  status: string;
  trialEndsAt: string | null;
  trialExpired: boolean;
  /** Effective features after trial expiry (expired trials fall back to Starter features). */
  features: PlanFeatures;
  limits: PlanLimits;
};

const FEATURE_LABEL: Record<keyof PlanFeatures, string> = {
  reorder_engine: "Reorder recommendations",
  supplier_analysis: "Supplier analysis",
  assistant: "Ask StockPilot",
  invoice_extraction: "Invoice extraction",
  advanced_reports: "Advanced reports",
};

/** Loads entitlements for the current tenant (RLS restricts to the active business). */
export async function getEntitlements(db: Tx, businessId: string): Promise<Entitlements> {
  const row = await db.one<{
    code: string; name: string; price_inr_monthly: string | null; is_custom_price: boolean; description: string;
    limits: PlanLimits; features: PlanFeatures; plan_status: string; trial_ends_at: Date | null; expired: boolean;
  }>(
    `SELECT p.code, p.name, p.price_inr_monthly, p.is_custom_price, p.description, p.limits, p.features,
            b.plan_status, b.trial_ends_at,
            (b.plan_code = 'trial' AND b.trial_ends_at IS NOT NULL AND b.trial_ends_at < now()) AS expired
       FROM businesses b JOIN plans p ON p.code = b.plan_code WHERE b.id = $1`,
    [businessId],
  );
  let features = row.features;
  let limits = row.limits;
  if (row.expired || row.plan_status === "cancelled") {
    const starter = await db.one<{ features: PlanFeatures; limits: PlanLimits }>("SELECT features, limits FROM plans WHERE code = 'starter'");
    features = starter.features;
    limits = { ...starter.limits, max_products: Math.min(starter.limits.max_products, row.limits.max_products) };
  }
  return {
    plan: {
      code: row.code,
      name: row.name,
      priceInrMonthly: row.price_inr_monthly,
      isCustomPrice: row.is_custom_price,
      description: row.description,
      limits: row.limits,
      features: row.features,
    },
    status: row.plan_status,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    trialExpired: row.expired,
    features,
    limits,
  };
}

export function requireFeature(ent: Entitlements, feature: keyof PlanFeatures) {
  if (!ent.features[feature]) {
    throw new LimitError(
      `${FEATURE_LABEL[feature]} is not included in your ${ent.trialExpired ? "expired trial" : ent.plan.name} plan. Upgrade to Growth to use it.`,
    );
  }
}

export async function assertProductCapacity(db: Tx, businessId: string, ent: Entitlements, adding: number) {
  const { count } = await db.one<{ count: number }>("SELECT count(*)::int AS count FROM products WHERE business_id = $1", [businessId]);
  if (count + adding > ent.limits.max_products) {
    throw new LimitError(
      `Your plan allows ${ent.limits.max_products.toLocaleString("en-IN")} products; this would bring you to ${(count + adding).toLocaleString("en-IN")}. Archive unused products or upgrade your plan.`,
    );
  }
}

export async function monthlyUsage(db: Tx, businessId: string) {
  return db.one<{ imports: number; ai: number; invoices: number }>(
    `SELECT
       (SELECT count(*)::int FROM import_jobs WHERE business_id = $1 AND status = 'committed' AND committed_at >= date_trunc('month', now())) AS imports,
       (SELECT count(*)::int FROM ai_usage WHERE business_id = $1 AND feature = 'assistant' AND status <> 'skipped' AND created_at >= date_trunc('month', now())) AS ai,
       (SELECT count(*)::int FROM invoice_documents WHERE business_id = $1 AND created_at >= date_trunc('month', now())) AS invoices`,
    [businessId],
  );
}

export async function assertMonthlyQuota(db: Tx, businessId: string, ent: Entitlements, kind: "imports" | "ai" | "invoices") {
  const usage = await monthlyUsage(db, businessId);
  const limit = kind === "imports" ? ent.limits.imports_per_month : kind === "ai" ? ent.limits.ai_requests_per_month : ent.limits.invoice_extractions_per_month;
  if (usage[kind] >= limit) {
    const what = kind === "imports" ? "imports" : kind === "ai" ? "AI questions" : "invoice extractions";
    throw new LimitError(`You have used all ${limit} ${what} included in your plan this month. The allowance resets on the 1st, or you can upgrade.`);
  }
}
