import "server-only";
import type { Tx } from "@/lib/db";
import { addDays, todayIn, type ISODate } from "@/lib/domain/dates";
import { estimateDemand, estimateStockoutDays, type DemandStats } from "@/lib/domain/demand";
import { recommendReorder, type ReorderResult } from "@/lib/domain/reorder";
import type { AnalysisSettings } from "@/lib/domain/settings";
import { classifyMovement, findPossibleDuplicates, percentile, suspiciousCostChange, type CostChange, type DuplicateCandidate, type MovementResult } from "@/lib/domain/slow-moving";

/**
 * Loads everything the deterministic engines need for one workspace in a handful of set-based queries,
 * then runs demand estimation, reorder recommendations and movement classification per product.
 * All numbers shown on the dashboard, purchase list, reports and assistant come from here.
 */

export type ProductAnalysis = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  baseUnit: string;
  active: boolean;
  onHand: number;
  unitCost: number | null;
  costSource: "supplier_price" | "product_cost" | null;
  supplierId: string | null;
  supplierName: string | null;
  lastSaleDate: ISODate | null;
  qtySoldInWindow: number;
  salesValueInWindow: number;
  demand: DemandStats;
  reorder: ReorderResult;
  movement: MovementResult;
  recentStockoutDays: number;
  costChange: CostChange | null;
};

export type WorkspaceAnalysis = {
  asOf: ISODate;
  timezone: string;
  settings: AnalysisSettings;
  windowDays: number;
  salesCoverage: { start: ISODate | null; end: ISODate | null };
  lastSnapshotAt: ISODate | null;
  lastImportAt: string | null;
  products: ProductAnalysis[];
  duplicates: DuplicateCandidate[];
  inboundOpenPoCount: number;
};

type Num = string | null;

export async function analyzeWorkspace(
  db: Tx,
  businessId: string,
  settings: AnalysisSettings,
  opts: { timezone: string; windowDays?: number; asOf?: ISODate; productIds?: string[] } = { timezone: "Asia/Kolkata" },
): Promise<WorkspaceAnalysis> {
  const tz = opts.timezone;
  const asOf = opts.asOf ?? todayIn(tz);
  const windowDays = opts.windowDays ?? settings.slowMovingDays;
  const filterIds = opts.productIds ?? null;

  const coverage = await db.one<{ start: ISODate | null; end: ISODate | null }>(
    "SELECT min(sold_on) AS start, max(sold_on) AS end FROM sales_lines WHERE business_id = $1",
    [businessId],
  );
  const lookbackStart = coverage.end ? addDays(coverage.end, -Math.max(settings.demandLookbackDays, windowDays, 60) - 1) : asOf;

  const products = await db.query<{
    id: string; sku: string; name: string; category: string | null; brand: string | null; base_unit: string; active: boolean;
    on_hand: string; reserved_qty: string; min_stock: Num; max_stock: Num; safety_stock: Num; lead_time_days: number | null;
    purchase_cost: Num; preferred_supplier_id: string | null; introduced_on: ISODate | null;
    supplier_name: string | null; supplier_lead: number | null; sp_lead: number | null; sp_price: Num; sp_moq: Num; sp_pack: Num; sp_supplier_id: string | null;
  }>(
    `SELECT p.id, p.sku, p.name, p.category, p.brand, p.base_unit, p.active, p.on_hand, p.reserved_qty, p.min_stock, p.max_stock,
            p.safety_stock, p.lead_time_days, p.purchase_cost, p.preferred_supplier_id, p.introduced_on,
            s.name AS supplier_name, s.default_lead_time_days AS supplier_lead,
            sp.lead_time_days AS sp_lead, sp.purchase_price AS sp_price, sp.moq AS sp_moq, sp.pack_size AS sp_pack, sp.supplier_id AS sp_supplier_id
       FROM products p
       LEFT JOIN LATERAL (
         SELECT x.* FROM supplier_products x
          WHERE x.product_id = p.id AND (p.preferred_supplier_id IS NULL OR x.supplier_id = p.preferred_supplier_id)
          ORDER BY (x.supplier_id = p.preferred_supplier_id) DESC NULLS LAST, x.purchase_price NULLS LAST LIMIT 1
       ) sp ON true
       LEFT JOIN suppliers s ON s.id = coalesce(p.preferred_supplier_id, sp.supplier_id)
      WHERE p.business_id = $1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
      ORDER BY p.name`,
    [businessId, filterIds],
  );

  // Sequential on purpose: one transaction = one connection, which cannot run queries concurrently.
  const [salesRows, countRows, moveRows, purchaseRows, inboundRows, lastSales, meta] = await sequence([
    () => db.query<{ product_id: string; d: ISODate; q: string; v: Num }>(
      `SELECT product_id, sold_on AS d, sum(quantity) AS q, sum(line_total) AS v FROM sales_lines
        WHERE business_id = $1 AND sold_on >= $2 GROUP BY product_id, sold_on`,
      [businessId, lookbackStart],
    ),
    () => db.query<{ product_id: string; d: ISODate; q: string }>(
      `SELECT l.product_id, (s.snapshot_at AT TIME ZONE $2)::date::text AS d, l.counted_qty AS q
         FROM stock_snapshot_lines l JOIN stock_snapshots s ON s.id = l.snapshot_id
        WHERE l.business_id = $1
       UNION ALL
       SELECT product_id, (occurred_at AT TIME ZONE $2)::date::text, quantity FROM inventory_movements
        WHERE business_id = $1 AND movement_type = 'opening' AND source_type = 'manual'`,
      [businessId, tz],
    ),
    () => db.query<{ product_id: string; d: ISODate; q: string }>(
      `SELECT product_id, (occurred_at AT TIME ZONE $2)::date::text AS d, sum(quantity) AS q FROM inventory_movements
        WHERE business_id = $1 AND movement_type NOT IN ('opening','snapshot_adjustment')
        GROUP BY product_id, 2`,
      [businessId, tz],
    ),
    () => db.query<{ product_id: string; d: ISODate; q: string; cost: Num }>(
      `SELECT product_id, purchased_on AS d, sum(quantity) AS q, max(unit_cost) AS cost FROM purchase_history_lines
        WHERE business_id = $1 GROUP BY product_id, purchased_on ORDER BY purchased_on`,
      [businessId],
    ),
    () => db.query<{ product_id: string; inbound: string; po_count: number }>(
      `SELECT l.product_id, sum(greatest(l.quantity_base - l.received_qty_base, 0)) AS inbound, count(DISTINCT o.id)::int AS po_count
         FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id
        WHERE l.business_id = $1 AND o.status IN ('sent','partially_received')
        GROUP BY l.product_id`,
      [businessId],
    ),
    () => db.query<{ product_id: string; d: ISODate }>("SELECT product_id, max(sold_on) AS d FROM sales_lines WHERE business_id = $1 GROUP BY product_id", [businessId]),
    () => db.one<{ last_snapshot: ISODate | null; last_import: Date | null; open_pos: number }>(
      `SELECT (SELECT (max(snapshot_at) AT TIME ZONE $2)::date::text FROM stock_snapshots WHERE business_id = $1) AS last_snapshot,
              (SELECT max(committed_at) FROM import_jobs WHERE business_id = $1 AND status = 'committed') AS last_import,
              (SELECT count(*)::int FROM purchase_orders WHERE business_id = $1 AND status IN ('sent','partially_received')) AS open_pos`,
      [businessId, tz],
    ),
  ] as const);

  const group = <T extends { product_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const arr = m.get(r.product_id);
      if (arr) arr.push(r);
      else m.set(r.product_id, [r]);
    }
    return m;
  };
  const salesBy = group(salesRows);
  const countsBy = group(countRows);
  const movesBy = group(moveRows);
  const purchBy = group(purchaseRows);
  const inboundBy = new Map(inboundRows.map((r) => [r.product_id, Number(r.inbound)]));
  const lastSaleBy = new Map(lastSales.map((r) => [r.product_id, r.d]));

  const windowStart = coverage.end ? addDays(coverage.end, -(windowDays - 1)) : null;
  const recentStart = coverage.end ? addDays(coverage.end, -29) : null;

  const partial: Omit<ProductAnalysis, "movement">[] = [];
  const values: number[] = [];

  for (const p of products) {
    const daily = new Map<ISODate, number>();
    let qtyWindow = 0;
    let valueWindow = 0;
    for (const s of salesBy.get(p.id) ?? []) {
      const q = Number(s.q);
      daily.set(s.d, q);
      if (windowStart && s.d >= windowStart) {
        qtyWindow += q;
        valueWindow += Number(s.v ?? 0);
      }
    }
    const counts = new Map<ISODate, number>();
    for (const c of countsBy.get(p.id) ?? []) counts.set(c.d, Number(c.q));
    const purch = new Map<ISODate, number>();
    const costs: number[] = [];
    for (const r of purchBy.get(p.id) ?? []) {
      purch.set(r.d, Number(r.q));
      if (r.cost !== null) costs.push(Number(r.cost));
    }

    const demandFrom = coverage.end ? addDays(coverage.end, -(settings.demandLookbackDays - 1)) : asOf;
    const stockouts = coverage.end
      ? estimateStockoutDays({
          counts,
          movements: (movesBy.get(p.id) ?? []).map((m) => ({ date: m.d, quantity: Number(m.q) })),
          dailySales: daily,
          dailyPurchases: purch,
          from: demandFrom < (coverage.start ?? demandFrom) ? coverage.start! : demandFrom,
          to: coverage.end,
        })
      : new Set<ISODate>();

    const demand = estimateDemand({
      dailySales: daily,
      coverageStart: coverage.start,
      coverageEnd: coverage.end,
      stockoutDays: stockouts,
      lookbackDays: settings.demandLookbackDays,
      minHistoryDays: settings.minHistoryDays,
      productSince: p.introduced_on,
      useTrendAdjustment: settings.useTrendAdjustment,
    });

    let leadTime = settings.defaultLeadTimeDays;
    let leadSource: "product" | "supplier_product" | "supplier" | "business_default" = "business_default";
    if (p.lead_time_days !== null) [leadTime, leadSource] = [p.lead_time_days, "product"];
    else if (p.sp_lead !== null) [leadTime, leadSource] = [p.sp_lead, "supplier_product"];
    else if (p.supplier_lead !== null) [leadTime, leadSource] = [p.supplier_lead, "supplier"];

    const unitCost = p.sp_price !== null ? Number(p.sp_price) : p.purchase_cost !== null ? Number(p.purchase_cost) : null;
    const onHand = Number(p.on_hand);
    const reorder = recommendReorder({
      active: p.active,
      onHand,
      inbound: inboundBy.get(p.id) ?? 0,
      reserved: Number(p.reserved_qty),
      demand,
      leadTimeDays: leadTime,
      leadTimeSource: leadSource,
      safetyStock: p.safety_stock === null ? null : Number(p.safety_stock),
      defaultSafetyDays: settings.defaultSafetyDays,
      minStock: p.min_stock === null ? null : Number(p.min_stock),
      maxStock: p.max_stock === null ? null : Number(p.max_stock),
      targetCoverageDays: settings.targetCoverageDays,
      moq: p.sp_moq === null ? null : Number(p.sp_moq),
      packSize: p.sp_pack === null ? null : Number(p.sp_pack),
      unitCost,
    });

    if (unitCost !== null && onHand > 0) values.push(onHand * unitCost);
    partial.push({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      brand: p.brand,
      baseUnit: p.base_unit,
      active: p.active,
      onHand,
      unitCost,
      costSource: p.sp_price !== null ? "supplier_price" : p.purchase_cost !== null ? "product_cost" : null,
      supplierId: p.preferred_supplier_id ?? p.sp_supplier_id,
      supplierName: p.supplier_name,
      lastSaleDate: lastSaleBy.get(p.id) ?? null,
      qtySoldInWindow: round3(qtyWindow),
      salesValueInWindow: Math.round(valueWindow * 100) / 100,
      demand,
      reorder,
      recentStockoutDays: recentStart ? [...stockouts].filter((d) => d >= recentStart).length : 0,
      costChange: suspiciousCostChange(costs),
    });
  }

  const highValue = percentile(values, 0.9);
  const introducedBy = new Map(products.map((p) => [p.id, p.introduced_on]));
  const analyzed: ProductAnalysis[] = partial.map((p) => ({
    ...p,
    movement: p.active
      ? classifyMovement({
          onHand: p.onHand,
          unitCost: p.unitCost,
          qtySoldInWindow: p.qtySoldInWindow,
          lastSaleDate: p.lastSaleDate,
          averageDailyDemand: p.demand.averageDailyDemand,
          coverageStart: coverage.start,
          coverageEnd: coverage.end,
          productSince: introducedBy.get(p.id) ?? null,
          windowDays,
          slowVelocityPerMonth: settings.slowVelocityPerMonth,
          excessCoverageDays: settings.excessCoverageDays,
          highValueThreshold: highValue,
        })
      : { status: "unknown", flags: [], velocityPerMonth: null, daysSinceLastSale: null, daysOfCover: null, stockValue: null, excessQty: 0, excessValue: null },
  }));

  const duplicates = filterIds
    ? []
    : findPossibleDuplicates(products.filter((p) => p.active).map((p) => ({ id: p.id, sku: p.sku, name: p.name, barcode: null, mpn: null, brand: p.brand })));

  return {
    asOf,
    timezone: tz,
    settings,
    windowDays,
    salesCoverage: coverage,
    lastSnapshotAt: meta.last_snapshot,
    lastImportAt: meta.last_import ? new Date(meta.last_import).toISOString() : null,
    products: analyzed,
    duplicates,
    inboundOpenPoCount: meta.open_pos,
  };
}

// ------------------------------------------------------------------ dashboard metrics

export type DashboardMetrics = {
  activeSkus: number;
  unitsOnHand: number;
  inventoryValue: number;
  itemsMissingCost: number;
  lowStock: number;
  outOfStock: number;
  excessSkus: number;
  excessValue: number;
  slowMoving: number;
  nonMoving: number;
  noRecordedSales: number;
  nonMovingValue: number;
  recentStockouts: number;
  recommendations: number;
  recommendationValue: number;
  provisionalRecommendations: number;
  negativeStock: number;
  duplicateGroups: number;
  costJumps: number;
};

/** Pure aggregation — tested against fixtures so dashboard totals always match the underlying rows. */
export function dashboardMetrics(a: Pick<WorkspaceAnalysis, "products" | "duplicates">): DashboardMetrics {
  const active = a.products.filter((p) => p.active);
  const m: DashboardMetrics = {
    activeSkus: active.length,
    unitsOnHand: 0,
    inventoryValue: 0,
    itemsMissingCost: 0,
    lowStock: 0,
    outOfStock: 0,
    excessSkus: 0,
    excessValue: 0,
    slowMoving: 0,
    nonMoving: 0,
    noRecordedSales: 0,
    nonMovingValue: 0,
    recentStockouts: 0,
    recommendations: 0,
    recommendationValue: 0,
    provisionalRecommendations: 0,
    negativeStock: 0,
    duplicateGroups: a.duplicates.length,
    costJumps: 0,
  };
  for (const p of active) {
    if (p.onHand > 0) {
      m.unitsOnHand += p.onHand;
      if (p.unitCost === null) m.itemsMissingCost++;
      else m.inventoryValue += p.onHand * p.unitCost;
    }
    if (p.onHand < 0) m.negativeStock++;
    if (p.onHand <= 0) m.outOfStock++;
    else if (isLowStock(p)) m.lowStock++;
    if (p.movement.flags.some((f) => f.code === "excess" || f.code === "non_moving")) {
      m.excessSkus++;
      m.excessValue += p.movement.excessValue ?? 0;
    }
    if (p.movement.status === "slow") m.slowMoving++;
    if (p.movement.status === "non_moving") {
      m.nonMoving++;
      m.nonMovingValue += p.movement.stockValue ?? 0;
    }
    if (p.movement.status === "no_recorded_sales") m.noRecordedSales++;
    if (p.recentStockoutDays > 0) m.recentStockouts++;
    if (p.reorder.suggestedQty > 0) {
      m.recommendations++;
      m.recommendationValue += p.reorder.estimatedCost ?? 0;
      if (p.reorder.provisional) m.provisionalRecommendations++;
    }
    if (p.costChange) m.costJumps++;
  }
  m.unitsOnHand = round3(m.unitsOnHand);
  m.inventoryValue = Math.round(m.inventoryValue * 100) / 100;
  m.excessValue = Math.round(m.excessValue * 100) / 100;
  m.nonMovingValue = Math.round(m.nonMovingValue * 100) / 100;
  m.recommendationValue = Math.round(m.recommendationValue * 100) / 100;
  return m;
}

/** In stock but at or below the reorder point (or below minimum stock when no reorder point is available). */
export function isLowStock(p: Pick<ProductAnalysis, "onHand" | "reorder">): boolean {
  if (p.onHand <= 0) return false;
  return p.reorder.urgency === "critical" || p.reorder.urgency === "reorder";
}

function round3(n: number) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

type Thunks = readonly (() => Promise<unknown>)[];
async function sequence<T extends Thunks>(fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

export async function monthlySalesTrend(db: Tx, businessId: string, months = 6) {
  return db.query<{ month: string; qty: string; value: Num; days: number }>(
    `SELECT to_char(date_trunc('month', sold_on), 'YYYY-MM') AS month, sum(quantity) AS qty, sum(line_total) AS value,
            count(DISTINCT sold_on)::int AS days
       FROM sales_lines WHERE business_id = $1 AND sold_on >= date_trunc('month', (SELECT max(sold_on) FROM sales_lines WHERE business_id = $1)) - make_interval(months => $2 - 1)
      GROUP BY 1 ORDER BY 1`,
    [businessId, months],
  );
}
