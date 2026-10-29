import "server-only";
import type { Tx } from "@/lib/db";
import { addDays, daysBetweenInclusive, diffDays, formatDate, type ISODate } from "@/lib/domain/dates";
import { toCsv } from "@/lib/domain/imports/values";
import type { AnalysisSettings } from "@/lib/domain/settings";
import { AppError, NotFoundError } from "@/lib/errors";
import { analyzeWorkspace, dashboardMetrics, type DashboardMetrics } from "./analysis";
import { createDoc, fmtMoney, fmtQty, footer, heading, muted, subheading, table, toBuffer } from "./pdf";

type PeriodTotals = { qty: number; value: number; lines: number; products: number; daysWithData: number };

export type ReportItem = { productId: string; sku: string; name: string; supplier: string | null; onHand: number; unit: string; value: number | null; detail: string; qty?: number; cost?: number | null; status?: string };

export type WeeklyReport = {
  version: 1;
  business: { name: string; isDemo: boolean };
  period: { start: ISODate; end: ISODate; days: number };
  previous: { start: ISODate; end: ISODate };
  generatedAt: string;
  dataAsOf: { salesThrough: ISODate | null; lastStockCount: ISODate | null };
  metrics: DashboardMetrics;
  reorder: ReportItem[];
  reorderTotal: { items: number; value: number };
  stockoutRisks: ReportItem[];
  slow: ReportItem[];
  excessValue: number;
  sales: { current: PeriodTotals; previous: PeriodTotals; comparable: boolean; changePct: number | null };
  purchases: { current: PeriodTotals; previous: PeriodTotals; receiptsValue: number; comparable: boolean; changePct: number | null };
  suppliers: { supplier: string; items: number; value: number }[];
  dataQuality: string[];
  assumptions: string[];
};

async function periodTotals(db: Tx, table: "sales_lines" | "purchase_history_lines", businessId: string, start: ISODate, end: ISODate): Promise<PeriodTotals> {
  const dateCol = table === "sales_lines" ? "sold_on" : "purchased_on";
  const valueExpr = table === "sales_lines" ? "coalesce(line_total, quantity * unit_price, 0)" : "coalesce(line_total, quantity * unit_cost, 0)";
  const r = await db.one<{ qty: string | null; value: string | null; lines: number; products: number; days: number }>(
    `SELECT sum(quantity) AS qty, sum(${valueExpr}) AS value, count(*)::int AS lines, count(DISTINCT product_id)::int AS products, count(DISTINCT ${dateCol})::int AS days
       FROM ${table} WHERE business_id = $1 AND ${dateCol} BETWEEN $2 AND $3`,
    [businessId, start, end],
  );
  return { qty: Number(r.qty ?? 0), value: Math.round(Number(r.value ?? 0) * 100) / 100, lines: r.lines, products: r.products, daysWithData: r.days };
}

function change(cur: number, prev: number) {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
}

export async function buildWeeklyReport(db: Tx, businessId: string, settings: AnalysisSettings, timezone: string, period: { start: ISODate; end: ISODate }): Promise<WeeklyReport> {
  if (period.end < period.start) throw new AppError("The report end date must be on or after the start date.");
  const days = daysBetweenInclusive(period.start, period.end);
  if (days > 92) throw new AppError("Reports can cover up to 92 days.");
  const prevEnd = addDays(period.start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const biz = await db.one<{ name: string; is_demo: boolean }>("SELECT name, is_demo FROM businesses WHERE id = $1", [businessId]);

  const a = await analyzeWorkspace(db, businessId, settings, { timezone });
  const m = dashboardMetrics(a);
  const active = a.products.filter((p) => p.active);
  const item = (p: (typeof active)[number], detail: string, extra: Partial<ReportItem> = {}): ReportItem => ({
    productId: p.id, sku: p.sku, name: p.name, supplier: p.supplierName, onHand: p.onHand, unit: p.baseUnit, value: p.movement.stockValue, detail, ...extra,
  });

  const recs = active.filter((p) => p.reorder.suggestedQty > 0);
  const rank: Record<string, number> = { out_of_stock: 0, critical: 1, reorder: 2, watch: 3, ok: 4, not_applicable: 5 };
  recs.sort((x, y) => rank[x.reorder.urgency] - rank[y.reorder.urgency]);
  const reorder = recs.slice(0, 40).map((p) =>
    item(p, p.reorder.provisional ? "Provisional — limited history" : `Reorder point ${fmtQty(p.reorder.reorderPoint)}`, { qty: p.reorder.suggestedQty, cost: p.reorder.estimatedCost, status: p.reorder.urgency }),
  );
  const risks = active
    .filter((p) => p.reorder.urgency === "out_of_stock" || p.reorder.urgency === "critical")
    .map((p) => item(p, p.onHand <= 0 ? "Out of stock" : `About ${p.reorder.daysOfStock} days left; lead time ${p.reorder.leadTimeDays} days${p.reorder.inbound ? `; ${fmtQty(p.reorder.inbound)} on order` : ""}`, { status: p.reorder.urgency }));
  const slow = active
    .filter((p) => p.movement.status === "non_moving" || p.movement.status === "slow" || (p.movement.excessValue ?? 0) > 0)
    .sort((x, y) => (y.movement.excessValue ?? y.movement.stockValue ?? 0) - (x.movement.excessValue ?? x.movement.stockValue ?? 0))
    .slice(0, 30)
    .map((p) => item(p, p.movement.flags[0]?.label ?? "Excess stock", { cost: p.movement.excessValue }));

  const supplierMap = new Map<string, { supplier: string; items: number; value: number }>();
  for (const p of recs) {
    const k = p.supplierName ?? "No supplier set";
    const g = supplierMap.get(k) ?? { supplier: k, items: 0, value: 0 };
    g.items++;
    g.value = Math.round((g.value + (p.reorder.estimatedCost ?? 0)) * 100) / 100;
    supplierMap.set(k, g);
  }

  const salesCur = await periodTotals(db, "sales_lines", businessId, period.start, period.end);
  const salesPrev = await periodTotals(db, "sales_lines", businessId, prevStart, prevEnd);
  const purCur = await periodTotals(db, "purchase_history_lines", businessId, period.start, period.end);
  const purPrev = await periodTotals(db, "purchase_history_lines", businessId, prevStart, prevEnd);
  const receipts = await db.one<{ value: string | null }>(
    `SELECT sum(g.quantity_base * coalesce(g.unit_cost / g.unit_factor, p.purchase_cost, 0)) AS value
       FROM goods_receipt_lines g JOIN goods_receipts r ON r.id = g.goods_receipt_id JOIN products p ON p.id = g.product_id
      WHERE r.business_id = $1 AND r.status = 'confirmed' AND r.received_on BETWEEN $2 AND $3`,
    [businessId, period.start, period.end],
  );
  // Only compare periods when both have sales data on most days — otherwise a "drop" is just missing data.
  const salesComparable = a.salesCoverage.start !== null && a.salesCoverage.start <= prevStart && (a.salesCoverage.end ?? "") >= period.end;
  const purComparable = purPrev.lines > 0 && purCur.lines > 0;

  const quality: string[] = [];
  const salesAge = a.salesCoverage.end ? diffDays(a.salesCoverage.end, a.asOf) : null;
  if (salesAge === null) quality.push("No sales history imported — demand-based advice is not available.");
  else if (salesAge > 7) quality.push(`Sales data stops at ${formatDate(a.salesCoverage.end)} (${salesAge} days ago). Import recent sales for current advice.`);
  if (a.salesCoverage.end && a.salesCoverage.end < period.end) quality.push(`Sales after ${formatDate(a.salesCoverage.end)} are not imported, so this period's sales are incomplete.`);
  const countAge = a.lastSnapshotAt ? diffDays(a.lastSnapshotAt, a.asOf) : null;
  if (countAge === null) quality.push("No stock count has been imported.");
  else if (countAge > 31) quality.push(`Last stock count was ${countAge} days ago.`);
  if (m.itemsMissingCost) quality.push(`${m.itemsMissingCost} in-stock item(s) have no purchase cost, so stock value is understated.`);
  if (m.negativeStock) quality.push(`${m.negativeStock} item(s) show negative stock.`);
  if (m.duplicateGroups) quality.push(`${m.duplicateGroups} possible duplicate product group(s).`);
  if (m.costJumps) quality.push(`${m.costJumps} item(s) had a purchase cost change of 40% or more.`);
  if (m.provisionalRecommendations) quality.push(`${m.provisionalRecommendations} reorder suggestion(s) are provisional because of limited sales history.`);

  const assumptions = [
    `Demand is the average of units sold per in-stock day over the last ${settings.demandLookbackDays} days of imported sales; days when an item was out of stock are excluded.`,
    `Reorder point = average daily sales × lead time + safety stock (default ${settings.defaultSafetyDays} days of sales when not set). Orders top up to lead time + ${settings.targetCoverageDays} days of cover.`,
    `Lead time uses the product setting, then the supplier item setting, then the supplier default, then ${settings.defaultLeadTimeDays} days.`,
    "Stock on order counts only purchase orders marked as sent. Draft orders are not counted.",
    `Excess stock is anything beyond ${settings.excessCoverageDays} days of sales; non-moving means no sales over the whole window while history covers it.`,
    "Imported sales measure demand only; they do not reduce stock. Stock comes from stock counts and confirmed goods receipts.",
    "Values are at purchase cost (supplier price where recorded). Nothing in this report has been ordered or paid for.",
  ];

  return {
    version: 1,
    business: { name: biz.name, isDemo: biz.is_demo },
    period: { start: period.start, end: period.end, days },
    previous: { start: prevStart, end: prevEnd },
    generatedAt: new Date().toISOString(),
    dataAsOf: { salesThrough: a.salesCoverage.end, lastStockCount: a.lastSnapshotAt },
    metrics: m,
    reorder,
    reorderTotal: { items: recs.length, value: Math.round(recs.reduce((s, p) => s + (p.reorder.estimatedCost ?? 0), 0) * 100) / 100 },
    stockoutRisks: risks,
    slow,
    excessValue: m.excessValue,
    sales: { current: salesCur, previous: salesPrev, comparable: salesComparable, changePct: salesComparable ? change(salesCur.value, salesPrev.value) : null },
    purchases: { current: purCur, previous: purPrev, receiptsValue: Math.round(Number(receipts.value ?? 0) * 100) / 100, comparable: purComparable, changePct: purComparable ? change(purCur.value, purPrev.value) : null },
    suppliers: [...supplierMap.values()].sort((x, y) => y.value - x.value),
    dataQuality: quality,
    assumptions,
  };
}

export async function saveReport(db: Tx, ctx: { userId: string; businessId: string }, data: WeeklyReport) {
  const r = await db.one<{ id: string }>(
    "INSERT INTO reports (business_id, kind, period_start, period_end, data, generated_by) VALUES ($1,'weekly',$2,$3,$4,$5) RETURNING id",
    [ctx.businessId, data.period.start, data.period.end, JSON.stringify(data), ctx.userId],
  );
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id) VALUES ($1,$2,'report.generated','report',$3)", [ctx.businessId, ctx.userId, r.id]);
  return r.id;
}

export async function listReports(db: Tx, businessId: string) {
  return db.query<{ id: string; period_start: string; period_end: string; generated_at: Date }>("SELECT id, period_start, period_end, generated_at FROM reports WHERE business_id = $1 ORDER BY generated_at DESC LIMIT 30", [businessId]);
}

export async function getReport(db: Tx, businessId: string, id: string): Promise<{ id: string; data: WeeklyReport; generated_at: Date }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundError("Report");
  const r = await db.maybeOne<{ id: string; data: WeeklyReport; generated_at: Date }>("SELECT id, data, generated_at FROM reports WHERE business_id = $1 AND id = $2", [businessId, id]);
  if (!r) throw new NotFoundError("Report");
  return r;
}

const URG: Record<string, string> = { out_of_stock: "Out of stock", critical: "Runs out before delivery", reorder: "Reorder", watch: "Watch", ok: "OK" };

export function reportCsv(d: WeeklyReport, section: "reorder" | "stockouts" | "slow" | "suppliers"): string {
  switch (section) {
    case "reorder":
      return toCsv(["SKU", "Product", "Supplier", "Status", "In stock", "Unit", "Suggested order", "Estimated cost", "Note"], d.reorder.map((r) => [r.sku, r.name, r.supplier ?? "", URG[r.status ?? ""] ?? r.status ?? "", r.onHand, r.unit, r.qty ?? "", r.cost ?? "", r.detail]));
    case "stockouts":
      return toCsv(["SKU", "Product", "Supplier", "Status", "In stock", "Unit", "Detail"], d.stockoutRisks.map((r) => [r.sku, r.name, r.supplier ?? "", URG[r.status ?? ""] ?? "", r.onHand, r.unit, r.detail]));
    case "slow":
      return toCsv(["SKU", "Product", "Supplier", "In stock", "Unit", "Stock value", "Excess value", "Reason"], d.slow.map((r) => [r.sku, r.name, r.supplier ?? "", r.onHand, r.unit, r.value ?? "", r.cost ?? "", r.detail]));
    case "suppliers":
      return toCsv(["Supplier", "Items to reorder", "Estimated value"], d.suppliers.map((s) => [s.supplier, s.items, s.value]));
  }
}

export async function reportPdf(d: WeeklyReport): Promise<Buffer> {
  const doc = createDoc(`Inventory report ${d.period.start} to ${d.period.end}`);
  const w = doc.page.width - doc.page.margins.left * 2;
  heading(doc, `Inventory report — ${d.business.name}`, 15);
  muted(doc, `${formatDate(d.period.start)} to ${formatDate(d.period.end)} · generated ${new Date(d.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · sales data through ${formatDate(d.dataAsOf.salesThrough)} · last stock count ${formatDate(d.dataAsOf.lastStockCount)}`);
  if (d.business.isDemo) doc.fillColor("#9a5b05").text("Synthetic demo data — not a real business.").fillColor("#10233f");

  subheading(doc, "Summary (values in INR at cost)");
  table(
    doc,
    [
      { key: "k", label: "Measure", width: w * 0.6 },
      { key: "v", label: "Value", width: w * 0.4, align: "right" },
    ],
    [
      { k: "Active products", v: String(d.metrics.activeSkus) },
      { k: "Stock value at cost", v: fmtMoney(d.metrics.inventoryValue) },
      { k: "Items to review for reorder", v: `${d.reorderTotal.items} (est. ${fmtMoney(d.reorderTotal.value)})` },
      { k: "Out of stock / runs out before delivery", v: String(d.stockoutRisks.length) },
      { k: "Excess and non-moving stock value", v: fmtMoney(d.excessValue) },
      { k: `Sales this period`, v: `${fmtMoney(d.sales.current.value)}${d.sales.changePct !== null ? ` (${d.sales.changePct > 0 ? "+" : ""}${d.sales.changePct}% vs previous)` : ""}` },
      { k: `Purchases recorded this period`, v: `${fmtMoney(d.purchases.current.value)}${d.purchases.changePct !== null ? ` (${d.purchases.changePct > 0 ? "+" : ""}${d.purchases.changePct}%)` : ""}` },
      { k: "Goods received (confirmed receipts)", v: fmtMoney(d.purchases.receiptsValue) },
    ],
  );
  if (!d.sales.comparable) muted(doc, "Sales are not compared with the previous period because imported sales history does not fully cover both periods.", { width: w });

  subheading(doc, `Reorder review (${d.reorderTotal.items} items${d.reorder.length < d.reorderTotal.items ? `, first ${d.reorder.length} shown` : ""})`);
  table(
    doc,
    [
      { key: "sku", label: "SKU", width: 80 },
      { key: "name", label: "Product", width: 150 },
      { key: "status", label: "Status", width: 80 },
      { key: "stock", label: "In stock", width: 55, align: "right" },
      { key: "qty", label: "Suggested", width: 55, align: "right" },
      { key: "cost", label: "Est. cost", width: 95, align: "right" },
    ],
    d.reorder.map((r) => ({ sku: r.sku, name: r.name, status: URG[r.status ?? ""] ?? "", stock: fmtQty(r.onHand), qty: fmtQty(r.qty), cost: fmtMoney(r.cost) })),
    { zebra: true },
  );

  if (d.suppliers.length) {
    subheading(doc, "Purchasing needs by supplier");
    table(doc, [{ key: "s", label: "Supplier", width: w * 0.55 }, { key: "i", label: "Items", width: w * 0.15, align: "right" }, { key: "v", label: "Est. value", width: w * 0.3, align: "right" }], d.suppliers.map((s) => ({ s: s.supplier, i: String(s.items), v: fmtMoney(s.value) })));
  }

  subheading(doc, `Stockout risks (${d.stockoutRisks.length})`);
  if (d.stockoutRisks.length) table(doc, [{ key: "sku", label: "SKU", width: 90 }, { key: "name", label: "Product", width: 190 }, { key: "d", label: "Detail", width: w - 280 }], d.stockoutRisks.slice(0, 40).map((r) => ({ sku: r.sku, name: r.name, d: r.detail })));
  else muted(doc, "None.");

  subheading(doc, "Slow-moving and excess stock");
  if (d.slow.length) table(doc, [{ key: "sku", label: "SKU", width: 85 }, { key: "name", label: "Product", width: 170 }, { key: "why", label: "Reason", width: 110 }, { key: "v", label: "Excess value", width: w - 365, align: "right" }], d.slow.map((r) => ({ sku: r.sku, name: r.name, why: r.detail, v: fmtMoney(r.cost) })));
  else muted(doc, "None found.");

  subheading(doc, "Data quality");
  if (d.dataQuality.length) d.dataQuality.forEach((q) => doc.text(`• ${q}`, { width: w }));
  else muted(doc, "No issues found.");
  subheading(doc, "How these numbers were calculated");
  d.assumptions.forEach((s) => muted(doc, `• ${s}`, { width: w }));
  footer(doc, `${d.business.name} · inventory report · prepared with StockPilot AI`);
  return toBuffer(doc);
}
