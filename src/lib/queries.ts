import "server-only";
import { cache } from "react";
import { analyzeWorkspace, type WorkspaceAnalysis } from "@/lib/services/analysis";
import { getEntitlements, type Entitlements } from "@/lib/services/entitlements";
import { tx, type TenantContext } from "@/lib/tenant";

/** Per-request cached analysis for the current tenant (several components on a page share it). */
export const loadAnalysis = cache(async (t: TenantContext, windowDays?: number): Promise<WorkspaceAnalysis> => {
  return tx(t, (db) => analyzeWorkspace(db, t.businessId, t.business.settings.analysis, { timezone: t.business.timezone, windowDays }));
});

export const loadEntitlements = cache(async (t: TenantContext): Promise<Entitlements> => tx(t, (db) => getEntitlements(db, t.businessId)));

export const ANALYSIS_VIEWS = {
  all: "All products",
  low: "Low stock",
  out: "Out of stock",
  reorder: "Purchase list",
  excess: "Excess stock",
  non_moving: "Non-moving",
  no_sales: "No recorded sales",
  slow: "Slow-moving",
  stockouts: "Recent stockouts",
  high_value: "High value, low sales",
  cost_jumps: "Purchase cost jumps",
} as const;
export type AnalysisView = keyof typeof ANALYSIS_VIEWS;
