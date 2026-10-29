import { addDays, daysBetweenInclusive, maxDate, type ISODate } from "./dates";

/**
 * Demand estimation (transparent moving average).
 *
 * Average daily demand (ADD) = units sold in the window ÷ number of IN-STOCK days in the window.
 * Days on which the product was out of stock are excluded from the denominator, because sales observed while
 * the shelf was empty under-state true demand (censored demand).
 *
 * The window ends at the last date covered by imported sales data (not "today"), so a stale sales export
 * does not look like a sudden drop in demand.
 */

export type DataQuality = "good" | "limited" | "insufficient" | "none";
export type Trend = "rising" | "falling" | "stable" | "unknown";

export type DemandInput = {
  /** Sales quantities (base unit) keyed by date. Dates outside the window are ignored. */
  dailySales: Map<ISODate, number>;
  /** First and last dates covered by the business's sales data (null if no sales data imported). */
  coverageStart: ISODate | null;
  coverageEnd: ISODate | null;
  /** Dates within the window on which closing stock was ≤ 0. */
  stockoutDays: Set<ISODate>;
  lookbackDays: number;
  minHistoryDays: number;
  /** Optional: date the product first existed in StockPilot / billing data. History before it is not counted. */
  productSince?: ISODate | null;
  useTrendAdjustment?: boolean;
};

export type DemandStats = {
  windowStart: ISODate | null;
  windowEnd: ISODate | null;
  observedDays: number;
  stockoutDays: number;
  inStockDays: number;
  totalQty: number;
  daysWithSales: number;
  /** Units per day (base unit). Null when it cannot be estimated. */
  averageDailyDemand: number | null;
  /** Plain moving average before any optional trend adjustment. */
  baselineDailyDemand: number | null;
  recentDailyDemand: number | null;
  priorDailyDemand: number | null;
  trend: Trend;
  trendRatio: number | null;
  intermittent: boolean;
  quality: DataQuality;
  notes: string[];
};

const RECENT_DAYS = 30;

export function estimateDemand(input: DemandInput): DemandStats {
  const notes: string[] = [];
  if (!input.coverageStart || !input.coverageEnd) {
    return empty("none", ["No sales history has been imported yet."]);
  }

  const windowEnd = input.coverageEnd;
  let windowStart = maxDate(input.coverageStart, addDays(windowEnd, -(input.lookbackDays - 1)));
  if (input.productSince && input.productSince > windowStart) windowStart = input.productSince;
  if (windowStart > windowEnd) {
    return empty("insufficient", ["The product was added after the latest imported sales data."], windowStart, windowEnd);
  }

  const observedDays = daysBetweenInclusive(windowStart, windowEnd);
  let stockouts = 0;
  let total = 0;
  let daysWithSales = 0;
  let recentQty = 0;
  let recentInStock = 0;
  let priorQty = 0;
  let priorInStock = 0;
  const recentStart = addDays(windowEnd, -(RECENT_DAYS - 1));

  for (let d = windowStart; d <= windowEnd; d = addDays(d, 1)) {
    const qty = input.dailySales.get(d) ?? 0;
    const out = input.stockoutDays.has(d);
    if (out) stockouts++;
    total += qty;
    if (qty > 0) daysWithSales++;
    if (d >= recentStart) {
      recentQty += qty;
      if (!out) recentInStock++;
    } else {
      priorQty += qty;
      if (!out) priorInStock++;
    }
  }

  const inStockDays = observedDays - stockouts;
  if (inStockDays <= 0) {
    return {
      ...empty("insufficient", ["The product was out of stock for the entire window, so demand cannot be measured."], windowStart, windowEnd),
      observedDays,
      stockoutDays: stockouts,
      totalQty: round(total),
      daysWithSales,
    };
  }

  const baseline = total / inStockDays;
  const recentRate = recentInStock >= 14 ? recentQty / recentInStock : null;
  const priorRate = priorInStock >= 14 ? priorQty / priorInStock : null;

  let trend: Trend = "unknown";
  let trendRatio: number | null = null;
  if (recentRate !== null && priorRate !== null) {
    if (priorRate === 0 && recentRate === 0) trend = "stable";
    else if (priorRate === 0) {
      trend = "rising";
    } else {
      trendRatio = recentRate / priorRate;
      trend = trendRatio >= 1.25 ? "rising" : trendRatio <= 0.8 ? "falling" : "stable";
    }
  }

  let add = baseline;
  if (input.useTrendAdjustment && recentRate !== null && priorRate !== null) {
    // Weighted moving average: 60% recent 30 days, 40% full window. Only when both periods are measurable.
    add = 0.6 * recentRate + 0.4 * baseline;
    notes.push("Demand weighted 60% toward the most recent 30 days (trend adjustment is on).");
  }

  const stockoutShare = stockouts / observedDays;
  const intermittent = inStockDays > 0 && daysWithSales / inStockDays < 0.2 && total > 0;

  let quality: DataQuality = "good";
  if (observedDays < input.minHistoryDays) {
    quality = "insufficient";
    notes.push(`Only ${observedDays} day(s) of sales history (minimum ${input.minHistoryDays} for a reliable estimate).`);
  } else {
    if (stockoutShare > 0.2) {
      quality = "limited";
      notes.push(`Out of stock on ${stockouts} of ${observedDays} days; those days are excluded from the average, but true demand may be higher.`);
    }
    if (total > 0 && daysWithSales < 3) {
      quality = "limited";
      notes.push(`Sold on only ${daysWithSales} day(s) in the window; demand is sparse and harder to predict.`);
    }
  }
  if (stockouts > 0 && stockoutShare <= 0.2) {
    notes.push(`Excluded ${stockouts} out-of-stock day(s) from the average.`);
  }
  if (intermittent) notes.push("Intermittent demand: sales occur on fewer than 1 in 5 in-stock days.");

  return {
    windowStart,
    windowEnd,
    observedDays,
    stockoutDays: stockouts,
    inStockDays,
    totalQty: round(total),
    daysWithSales,
    averageDailyDemand: round(add, 4),
    baselineDailyDemand: round(baseline, 4),
    recentDailyDemand: recentRate === null ? null : round(recentRate, 4),
    priorDailyDemand: priorRate === null ? null : round(priorRate, 4),
    trend,
    trendRatio: trendRatio === null ? null : round(trendRatio, 3),
    intermittent,
    quality,
    notes,
  };
}

function empty(quality: DataQuality, notes: string[], windowStart: ISODate | null = null, windowEnd: ISODate | null = null): DemandStats {
  return {
    windowStart,
    windowEnd,
    observedDays: 0,
    stockoutDays: 0,
    inStockDays: 0,
    totalQty: 0,
    daysWithSales: 0,
    averageDailyDemand: null,
    baselineDailyDemand: null,
    recentDailyDemand: null,
    priorDailyDemand: null,
    trend: "unknown",
    trendRatio: null,
    intermittent: false,
    quality,
    notes,
  };
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Estimates which days a product was out of stock.
 *
 * Stock counts (snapshot imports, opening balances) give the closing stock on their dates. Between counts the
 * estimated closing stock is carried forward as
 *   previous estimate + ledger receipts/adjustments − units sold + units bought (imported purchase history),
 * because imported sales and purchase history are not ledger movements.
 * A day only counts as a stockout when the estimate is ≤ 0 AND nothing was sold that day — a recorded sale
 * proves the item was in stock, which protects against missing receipt data.
 * Days before the first count or movement are unknown and never counted as stockouts.
 */
export function estimateStockoutDays(params: {
  /** Counted closing stock by date (snapshot lines, opening balances). */
  counts: Map<ISODate, number>;
  /** Non-count ledger movements (receipts, adjustments) — any order. */
  movements: { date: ISODate; quantity: number }[];
  dailySales: Map<ISODate, number>;
  /** Imported purchase-history quantities by date (optional). */
  dailyPurchases?: Map<ISODate, number>;
  from: ISODate;
  to: ISODate;
}): Set<ISODate> {
  const { counts, movements, dailySales, from, to } = params;
  const purchases = params.dailyPurchases ?? new Map<ISODate, number>();
  const out = new Set<ISODate>();
  const moves = new Map<ISODate, number>();
  let first: ISODate | null = null;
  for (const m of movements) {
    moves.set(m.date, (moves.get(m.date) ?? 0) + m.quantity);
    if (!first || m.date < first) first = m.date;
  }
  for (const d of counts.keys()) if (!first || d < first) first = d;
  if (!first) return out;
  let est = 0;
  for (let d = first; d <= to; d = addDays(d, 1)) {
    const sold = dailySales.get(d) ?? 0;
    const counted = counts.get(d);
    if (counted !== undefined) est = counted; // a count is the closing stock of that day
    else est += (moves.get(d) ?? 0) - sold + (purchases.get(d) ?? 0);
    if (d >= from && est <= 0 && sold === 0) out.add(d);
  }
  return out;
}
