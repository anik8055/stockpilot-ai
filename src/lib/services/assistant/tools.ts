import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addDays, type ISODate } from "@/lib/domain/dates";
import type { AnalysisSettings } from "@/lib/domain/settings";
import { analyzeWorkspace, dashboardMetrics, type ProductAnalysis, type WorkspaceAnalysis } from "../analysis";
import { supplierSpend } from "../purchasing";

/**
 * Read-only tools for Ask StockPilot. Every number in an answer comes from here — never from the model.
 * Each tool returns a small, already-aggregated result so only the necessary context reaches the LLM.
 */

export const TOOL_NAMES = ["reorder_candidates", "not_sold", "slow_stock_value", "supplier_share", "explain_product", "stock_changes", "rising_low_stock", "overview"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const toolCallSchema = z.object({
  tool: z.enum(TOOL_NAMES),
  params: z
    .object({
      limit: z.number().int().min(1).max(50).optional(),
      days: z.number().int().min(7).max(365).optional(),
      product: z.string().max(120).optional(),
    })
    .default({}),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export type Column = { key: string; label: string; kind: "text" | "qty" | "money" | "days" | "pct" | "date"; estimate?: boolean };
export type ToolResult = {
  tool: ToolName;
  title: string;
  period: string | null;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  /** Product IDs aligned with rows, for links. */
  productIds: (string | null)[];
  totals: Record<string, number>;
  notes: string[];
  /** One-line deterministic answer used when no AI interpretation is available. */
  summary: string;
  empty: boolean;
};

type Ctx = { db: Tx; businessId: string; settings: AnalysisSettings; timezone: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const rnd = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

async function analysis(c: Ctx, windowDays?: number): Promise<WorkspaceAnalysis> {
  return analyzeWorkspace(c.db, c.businessId, c.settings, { timezone: c.timezone, windowDays });
}

function periodOf(a: WorkspaceAnalysis, days?: number) {
  if (!a.salesCoverage.end) return null;
  const start = days ? addDays(a.salesCoverage.end, -(days - 1)) : a.salesCoverage.start;
  return `${start} to ${a.salesCoverage.end} (imported sales data)`;
}

export async function runTool(call: ToolCall, c: Ctx): Promise<ToolResult> {
  switch (call.tool) {
    case "reorder_candidates":
      return reorderCandidates(c, call.params.limit ?? 20);
    case "not_sold":
      return notSold(c, call.params.days ?? 90, call.params.limit ?? 25);
    case "slow_stock_value":
      return slowStockValue(c, call.params.days ?? c.settings.slowMovingDays);
    case "supplier_share":
      return supplierShare(c, call.params.days ?? 90);
    case "explain_product":
      return explainProduct(c, call.params.product ?? "");
    case "stock_changes":
      return stockChanges(c, call.params.days ?? 30);
    case "rising_low_stock":
      return risingLow(c, call.params.limit ?? 20);
    case "overview":
      return overview(c);
  }
}

const URG: Record<string, number> = { out_of_stock: 0, critical: 1, reorder: 2, watch: 3, ok: 4, not_applicable: 5 };
const URG_LABEL: Record<string, string> = { out_of_stock: "Out of stock", critical: "Runs out before delivery", reorder: "Reorder", watch: "Watch", ok: "OK", not_applicable: "—" };

async function reorderCandidates(c: Ctx, limit: number): Promise<ToolResult> {
  const a = await analysis(c);
  const recs = a.products.filter((p) => p.active && p.reorder.suggestedQty > 0).sort((x, y) => URG[x.reorder.urgency] - URG[y.reorder.urgency] || (x.reorder.daysOfStock ?? 0) - (y.reorder.daysOfStock ?? 0));
  const top = recs.slice(0, limit);
  const total = top.reduce((s, p) => s + (p.reorder.estimatedCost ?? 0), 0);
  return {
    tool: "reorder_candidates",
    title: `Top ${top.length} items to consider ordering`,
    period: periodOf(a, c.settings.demandLookbackDays),
    columns: [
      { key: "sku", label: "SKU", kind: "text" },
      { key: "name", label: "Product", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "on_hand", label: "In stock", kind: "qty" },
      { key: "on_order", label: "On order", kind: "qty" },
      { key: "days_left", label: "Days of stock", kind: "days", estimate: true },
      { key: "suggested", label: "Suggested order", kind: "qty", estimate: true },
      { key: "cost", label: "Est. cost", kind: "money", estimate: true },
      { key: "supplier", label: "Supplier", kind: "text" },
    ],
    rows: top.map((p) => ({
      sku: p.sku,
      name: p.name,
      status: URG_LABEL[p.reorder.urgency] + (p.reorder.provisional ? " (provisional)" : ""),
      on_hand: p.onHand,
      on_order: p.reorder.inbound,
      days_left: p.onHand > 0 ? p.reorder.daysOfStock : 0,
      suggested: p.reorder.suggestedQty,
      cost: p.reorder.estimatedCost,
      supplier: p.supplierName,
    })),
    productIds: top.map((p) => p.id),
    totals: { items: recs.length, shown: top.length, estimated_cost_shown: rnd(total) },
    notes: [
      "Suggested quantities are estimates from the reorder formula (average daily sales × lead time + safety stock, topped up to the coverage target). Nothing has been ordered.",
      ...(recs.length > top.length ? [`${recs.length - top.length} more item(s) are on the full purchase list.`] : []),
    ],
    summary: top.length ? `${recs.length} item(s) are at or below their reorder point. The top ${top.length} would cost about ${inr(total)} at current prices; ${top.filter((p) => p.reorder.urgency === "out_of_stock" || p.reorder.urgency === "critical").length} of them are out of stock or will run out before a new delivery arrives.` : "No items are at or below their reorder point right now.",
    empty: top.length === 0,
  };
}

async function notSold(c: Ctx, days: number, limit: number): Promise<ToolResult> {
  const a = await analysis(c, days);
  const confirmed = a.products.filter((p) => p.active && p.movement.status === "non_moving").sort((x, y) => (y.movement.stockValue ?? 0) - (x.movement.stockValue ?? 0));
  const unconfirmed = a.products.filter((p) => p.active && p.movement.status === "no_recorded_sales");
  const rows = confirmed.slice(0, limit);
  const value = confirmed.reduce((s, p) => s + (p.movement.stockValue ?? 0), 0);
  return {
    tool: "not_sold",
    title: `In stock with no sales in the last ${days} days`,
    period: periodOf(a, days),
    columns: [
      { key: "sku", label: "SKU", kind: "text" },
      { key: "name", label: "Product", kind: "text" },
      { key: "on_hand", label: "In stock", kind: "qty" },
      { key: "value", label: "Stock value", kind: "money" },
      { key: "last_sale", label: "Last sale", kind: "date" },
    ],
    rows: rows.map((p) => ({ sku: p.sku, name: p.name, on_hand: p.onHand, value: p.movement.stockValue, last_sale: p.lastSaleDate })),
    productIds: rows.map((p) => p.id),
    totals: { confirmed_items: confirmed.length, value: rnd(value), not_confirmed_items: unconfirmed.length },
    notes: [
      a.salesCoverage.end ? `"No sales" is judged on imported sales up to ${a.salesCoverage.end}.` : "No sales history has been imported, so nothing can be confirmed as non-moving.",
      ...(unconfirmed.length ? [`${unconfirmed.length} more item(s) have no recorded sales but too little history to confirm they are dead stock.`] : []),
    ],
    summary: confirmed.length ? `${confirmed.length} item(s) with stock have not sold in ${days} days, holding about ${inr(value)} at cost.` : `No in-stock item is confirmed as unsold for ${days} days.`,
    empty: confirmed.length === 0,
  };
}

async function slowStockValue(c: Ctx, days: number): Promise<ToolResult> {
  const a = await analysis(c, days);
  const items = a.products.filter((p) => p.active && (p.movement.excessValue ?? 0) > 0).sort((x, y) => (y.movement.excessValue ?? 0) - (x.movement.excessValue ?? 0));
  const m = dashboardMetrics(a);
  const top = items.slice(0, 15);
  return {
    tool: "slow_stock_value",
    title: "Money tied up in slow and excess stock",
    period: periodOf(a, days),
    columns: [
      { key: "sku", label: "SKU", kind: "text" },
      { key: "name", label: "Product", kind: "text" },
      { key: "status", label: "Why", kind: "text" },
      { key: "days_cover", label: "Days of cover", kind: "days", estimate: true },
      { key: "excess_value", label: "Excess value", kind: "money", estimate: true },
    ],
    rows: top.map((p) => ({ sku: p.sku, name: p.name, status: p.movement.status === "non_moving" ? "No sales in window" : p.movement.status === "slow" ? "Slow-moving" : "More stock than needed", days_cover: p.movement.daysOfCover, excess_value: p.movement.excessValue })),
    productIds: top.map((p) => p.id),
    totals: { excess_value: m.excessValue, non_moving_value: m.nonMovingValue, items: items.length, inventory_value: m.inventoryValue },
    notes: [`Excess = stock beyond ${c.settings.excessCoverageDays} days of sales at the current rate, plus all stock of confirmed non-moving items, valued at cost.`],
    summary: items.length ? `About ${inr(m.excessValue)} (${m.inventoryValue ? rnd((m.excessValue / m.inventoryValue) * 100, 1) : 0}% of stock value) is in excess or non-moving stock across ${items.length} item(s).` : "No excess or non-moving stock was found.",
    empty: items.length === 0,
  };
}

async function supplierShare(c: Ctx, days: number): Promise<ToolResult> {
  const rows = await supplierSpend(c.db, c.businessId, days);
  const total = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
  const top = rows.slice(0, 15);
  return {
    tool: "supplier_share",
    title: "Purchases by supplier",
    period: rows.length ? `last ${days} days of imported purchase history` : null,
    columns: [
      { key: "supplier", label: "Supplier", kind: "text" },
      { key: "value", label: "Purchase value", kind: "money" },
      { key: "share", label: "Share", kind: "pct" },
      { key: "products", label: "Items", kind: "qty" },
    ],
    rows: top.map((r) => ({ supplier: r.supplier_name ?? "Unknown supplier", value: rnd(Number(r.value ?? 0)), share: total ? rnd((Number(r.value ?? 0) / total) * 100, 1) : 0, products: r.products })),
    productIds: top.map(() => null),
    totals: { total_value: rnd(total), suppliers: rows.length },
    notes: rows.length ? ["Based on imported purchase history (and not on draft purchase orders)."] : ["No purchase history has been imported. Import a purchase register to see supplier shares."],
    summary: rows.length ? `${top[0].supplier_name ?? "An unknown supplier"} accounts for the largest share of purchases (${total ? rnd((Number(top[0].value ?? 0) / total) * 100, 1) : 0}% of ${inr(total)}).` : "There is no purchase history to analyse yet.",
    empty: rows.length === 0,
  };
}

async function findProduct(c: Ctx, q: string): Promise<{ id: string } | null> {
  const query = q.trim();
  if (!query) return null;
  const exact = await c.db.maybeOne<{ id: string }>(
    `SELECT id FROM products WHERE business_id = $1 AND (lower(sku) = lower($2) OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id = products.id AND lower(a.value) = lower($2))) LIMIT 1`,
    [c.businessId, query],
  );
  if (exact) return exact;
  const like = await c.db.query<{ id: string; name: string }>(
    "SELECT id, name FROM products WHERE business_id = $1 AND name ILIKE $2 ORDER BY similarity(name, $3) DESC LIMIT 5",
    [c.businessId, `%${query.replace(/[%_\\]/g, (m) => `\\${m}`).split(/\s+/).join("%")}%`, query],
  );
  if (like.length) return like[0];
  const fuzzy = await c.db.maybeOne<{ id: string }>("SELECT id FROM products WHERE business_id = $1 AND similarity(name, $2) > 0.3 ORDER BY similarity(name, $2) DESC LIMIT 1", [c.businessId, query]);
  return fuzzy;
}

async function explainProduct(c: Ctx, q: string): Promise<ToolResult> {
  const found = await findProduct(c, q);
  const base = { tool: "explain_product" as const, columns: [{ key: "item", label: "Item", kind: "text" as const }, { key: "value", label: "Value", kind: "text" as const }], productIds: [] as (string | null)[], totals: {} };
  if (!found) return { ...base, title: "Product not found", period: null, rows: [], notes: [`No product matches "${q}". Try the SKU.`], summary: `I could not find a product matching "${q}".`, empty: true };
  const a = await analyzeWorkspace(c.db, c.businessId, c.settings, { timezone: c.timezone, productIds: [found.id] });
  const p = a.products[0];
  const rows: Record<string, string | number | null>[] = [
    { item: "In stock", value: `${p.onHand} ${p.baseUnit}` },
    { item: "On order (sent POs)", value: `${p.reorder.inbound} ${p.baseUnit}` },
    { item: "Average daily sales (estimate)", value: p.demand.averageDailyDemand === null ? "not measurable" : `${p.demand.averageDailyDemand} ${p.baseUnit}` },
    { item: "Lead time", value: `${p.reorder.leadTimeDays} days` },
    { item: "Reorder point (estimate)", value: p.reorder.reorderPoint },
    { item: "Suggested order (estimate)", value: p.reorder.suggestedQty },
    { item: "Status", value: URG_LABEL[p.reorder.urgency] + (p.reorder.provisional ? " (provisional)" : "") },
    { item: "Data quality", value: p.demand.quality },
  ];
  return {
    ...base,
    title: `${p.name} (${p.sku})`,
    period: periodOf(a, c.settings.demandLookbackDays),
    rows,
    productIds: rows.map(() => p.id),
    totals: { suggested: p.reorder.suggestedQty },
    notes: [...p.reorder.reasons, ...p.movement.flags.map((f) => f.rule), ...p.reorder.warnings],
    summary: p.reorder.suggestedQty > 0 ? `${p.name} is flagged because stock plus incoming orders (${p.reorder.inventoryPosition}) is at or below its reorder point (${p.reorder.reorderPoint}).` : `${p.name} is not flagged for reorder: ${p.reorder.reasons.at(-1) ?? ""}`,
    empty: false,
  };
}

async function stockChanges(c: Ctx, days: number): Promise<ToolResult> {
  const rows = await c.db.query<{ movement_type: string; qty: string; lines: number; value: string | null }>(
    `SELECT m.movement_type, sum(m.quantity) AS qty, count(*)::int AS lines, sum(m.quantity * coalesce(m.unit_cost, p.purchase_cost)) AS value
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
      WHERE m.business_id = $1 AND m.occurred_at >= now() - make_interval(days => $2)
      GROUP BY 1 ORDER BY 1`,
    [c.businessId, days],
  );
  const top = await c.db.query<{ id: string; sku: string; name: string; qty: string; value: string | null }>(
    `SELECT p.id, p.sku, p.name, sum(m.quantity) AS qty, sum(m.quantity * coalesce(m.unit_cost, p.purchase_cost)) AS value
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
      WHERE m.business_id = $1 AND m.occurred_at >= now() - make_interval(days => $2)
      GROUP BY 1,2,3 ORDER BY abs(sum(m.quantity * coalesce(m.unit_cost, p.purchase_cost, 0))) DESC NULLS LAST LIMIT 10`,
    [c.businessId, days],
  );
  const LABEL: Record<string, string> = { opening: "Opening balances", snapshot_adjustment: "Stock count differences", receipt: "Goods received", manual_adjustment: "Manual adjustments" };
  const net = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
  const sales = await c.db.one<{ qty: string | null; value: string | null }>(
    "SELECT sum(quantity) AS qty, sum(line_total) AS value FROM sales_lines WHERE business_id = $1 AND sold_on >= current_date - $2::int",
    [c.businessId, days],
  );
  return {
    tool: "stock_changes",
    title: `What changed in stock in the last ${days} days`,
    period: `last ${days} days (stock ledger)`,
    columns: [
      { key: "what", label: "Change", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "qty", label: "Units", kind: "qty" },
      { key: "value", label: "Value at cost", kind: "money" },
    ],
    rows: [
      ...rows.map((r) => ({ what: LABEL[r.movement_type] ?? r.movement_type, sku: null, qty: rnd(Number(r.qty), 3), value: r.value === null ? null : rnd(Number(r.value)) })),
      ...top.map((t) => ({ what: `Largest change: ${t.name}`, sku: t.sku, qty: rnd(Number(t.qty), 3), value: t.value === null ? null : rnd(Number(t.value)) })),
    ],
    productIds: [...rows.map(() => null), ...top.map((t) => t.id)],
    totals: { net_value_change: rnd(net), sales_value: rnd(Number(sales.value ?? 0)) },
    notes: [
      "Stock changes come from stock counts, goods receipts and adjustments. Imported sales are not stock movements; their value is shown separately.",
      `Sales recorded in the same period: ${rnd(Number(sales.qty ?? 0), 3)} units worth ${inr(Number(sales.value ?? 0))}.`,
    ],
    summary: rows.length ? `Recorded stock changes in the last ${days} days add up to ${net >= 0 ? "+" : "−"}${inr(Math.abs(net))} at cost.` : `No stock movements were recorded in the last ${days} days.`,
    empty: rows.length === 0,
  };
}

async function risingLow(c: Ctx, limit: number): Promise<ToolResult> {
  const a = await analysis(c);
  const items = a.products
    .filter((p: ProductAnalysis) => p.active && p.demand.trend === "rising" && p.reorder.daysOfStock !== null && p.reorder.daysOfStock < p.reorder.leadTimeDays + c.settings.targetCoverageDays)
    .sort((x, y) => (x.reorder.daysOfStock ?? 0) - (y.reorder.daysOfStock ?? 0))
    .slice(0, limit);
  return {
    tool: "rising_low_stock",
    title: "Rising demand with low remaining stock",
    period: periodOf(a, c.settings.demandLookbackDays),
    columns: [
      { key: "sku", label: "SKU", kind: "text" },
      { key: "name", label: "Product", kind: "text" },
      { key: "recent", label: "Last 30 days / day", kind: "qty" },
      { key: "prior", label: "Earlier / day", kind: "qty" },
      { key: "days_left", label: "Days of stock", kind: "days", estimate: true },
      { key: "suggested", label: "Suggested order", kind: "qty", estimate: true },
    ],
    rows: items.map((p) => ({ sku: p.sku, name: p.name, recent: p.demand.recentDailyDemand, prior: p.demand.priorDailyDemand, days_left: p.reorder.daysOfStock, suggested: p.reorder.suggestedQty })),
    productIds: items.map((p) => p.id),
    totals: { items: items.length },
    notes: ["Rising = sales per in-stock day in the last 30 days at least 25% above the earlier part of the window (needs 14+ in-stock days in each part)."],
    summary: items.length ? `${items.length} item(s) are selling faster recently and have less stock than lead time plus your ${c.settings.targetCoverageDays}-day cover target.` : "No items combine rising demand with low stock.",
    empty: items.length === 0,
  };
}

async function overview(c: Ctx): Promise<ToolResult> {
  const a = await analysis(c);
  const m = dashboardMetrics(a);
  const rows = [
    { item: "Active products", value: m.activeSkus },
    { item: "Stock value at cost (₹)", value: m.inventoryValue },
    { item: "Low stock", value: m.lowStock },
    { item: "Out of stock", value: m.outOfStock },
    { item: "Items to reorder", value: m.recommendations },
    { item: "Estimated reorder cost (₹)", value: m.recommendationValue },
    { item: "Excess stock value (₹)", value: m.excessValue },
    { item: "Non-moving items", value: m.nonMoving },
  ];
  return {
    tool: "overview",
    title: "Stock position overview",
    period: periodOf(a, a.windowDays),
    columns: [{ key: "item", label: "Measure", kind: "text" }, { key: "value", label: "Value", kind: "qty" }],
    rows,
    productIds: rows.map(() => null),
    totals: { ...m } as unknown as Record<string, number>,
    notes: ["Same figures as the dashboard."],
    summary: `${m.activeSkus} active products worth ${inr(m.inventoryValue)} at cost; ${m.outOfStock} out of stock, ${m.lowStock} low, and ${inr(m.excessValue)} in excess stock.`,
    empty: m.activeSkus === 0,
  };
}

export type { ISODate };
