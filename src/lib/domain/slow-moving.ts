import { addDays, diffDays, type ISODate } from "./dates";

/**
 * Slow-moving, non-moving and excess stock classification.
 *
 * Important distinction:
 *   - "Confirmed non-moving": stock on hand, imported sales history covers the WHOLE window, and zero sales.
 *   - "No recorded sales": zero sales, but history is shorter than the window (or the product is newer than
 *     the window) — we cannot confirm it is dead stock.
 */

export type FlagCode =
  | "non_moving"
  | "no_recorded_sales"
  | "slow_moving"
  | "excess"
  | "high_value_slow"
  | "no_sales_data";

export type Flag = { code: FlagCode; label: string; rule: string; severity: "high" | "medium" | "info" };

export type MovementInput = {
  onHand: number;
  unitCost: number | null;
  /** Units sold within [windowEnd - windowDays + 1, windowEnd]. */
  qtySoldInWindow: number;
  lastSaleDate: ISODate | null;
  /** Average daily demand from the demand estimator (may be null). */
  averageDailyDemand: number | null;
  coverageStart: ISODate | null;
  coverageEnd: ISODate | null;
  productSince: ISODate | null;
  windowDays: number;
  slowVelocityPerMonth: number;
  excessCoverageDays: number;
  /** Stock value at or above which an item counts as "high value" (e.g. the workspace's 90th percentile). */
  highValueThreshold: number | null;
};

export type MovementResult = {
  status: "non_moving" | "no_recorded_sales" | "slow" | "moving" | "unknown" | "no_stock";
  flags: Flag[];
  velocityPerMonth: number | null;
  daysSinceLastSale: number | null;
  daysOfCover: number | null;
  stockValue: number | null;
  excessQty: number;
  excessValue: number | null;
};

export function classifyMovement(input: MovementInput): MovementResult {
  const flags: Flag[] = [];
  const stockValue = input.unitCost !== null ? round2(Math.max(0, input.onHand) * input.unitCost) : null;
  const res: MovementResult = {
    status: "unknown",
    flags,
    velocityPerMonth: null,
    daysSinceLastSale: input.lastSaleDate && input.coverageEnd ? diffDays(input.lastSaleDate, input.coverageEnd) : null,
    daysOfCover: null,
    stockValue,
    excessQty: 0,
    excessValue: null,
  };

  if (!input.coverageStart || !input.coverageEnd) {
    flags.push({
      code: "no_sales_data",
      label: "No sales data",
      rule: "No sales history has been imported for this workspace, so movement cannot be assessed.",
      severity: "info",
    });
    return res;
  }

  const windowEnd = input.coverageEnd;
  const windowStart = addDays(windowEnd, -(input.windowDays - 1));
  const historyCoversWindow = input.coverageStart <= windowStart && (!input.productSince || input.productSince <= windowStart);
  const velocity = (input.qtySoldInWindow / input.windowDays) * 30;
  res.velocityPerMonth = round2(velocity);
  if (input.averageDailyDemand && input.averageDailyDemand > 0) {
    res.daysOfCover = Math.round(Math.max(0, input.onHand) / input.averageDailyDemand);
  }

  if (input.onHand <= 0) {
    res.status = "no_stock";
    return res;
  }

  if (input.qtySoldInWindow <= 0) {
    if (historyCoversWindow) {
      res.status = "non_moving";
      flags.push({
        code: "non_moving",
        label: `Non-moving (${input.windowDays} days)`,
        rule: `No sales between ${windowStart} and ${windowEnd} (${input.windowDays} days), sales history covers the full period, and ${fmt(input.onHand)} units are in stock.`,
        severity: "high",
      });
      res.excessQty = round3(input.onHand);
      res.excessValue = stockValue;
    } else {
      res.status = "no_recorded_sales";
      flags.push({
        code: "no_recorded_sales",
        label: "No recorded sales",
        rule: `No sales recorded, but sales history only starts ${input.productSince && input.productSince > input.coverageStart ? `(product added ${input.productSince})` : `on ${input.coverageStart}`} — shorter than the ${input.windowDays}-day window, so this is not confirmed dead stock.`,
        severity: "info",
      });
    }
  } else if (velocity < input.slowVelocityPerMonth) {
    res.status = "slow";
    flags.push({
      code: "slow_moving",
      label: "Slow-moving",
      rule: `Sold ${fmt(input.qtySoldInWindow)} units in ${input.windowDays} days (${fmt(velocity, 2)}/month), below the threshold of ${fmt(input.slowVelocityPerMonth, 2)}/month.`,
      severity: "medium",
    });
  } else {
    res.status = "moving";
  }

  if (res.status !== "non_moving" && input.averageDailyDemand && input.averageDailyDemand > 0) {
    const needed = input.averageDailyDemand * input.excessCoverageDays;
    if (input.onHand > needed) {
      res.excessQty = round3(input.onHand - needed);
      res.excessValue = input.unitCost !== null ? round2(res.excessQty * input.unitCost) : null;
      flags.push({
        code: "excess",
        label: "Excess stock",
        rule: `${fmt(input.onHand)} in stock covers about ${res.daysOfCover} days at ${fmt(input.averageDailyDemand, 2)}/day, more than the ${input.excessCoverageDays}-day limit. Excess ≈ ${fmt(res.excessQty)} units.`,
        severity: "medium",
      });
    }
  }

  if (
    input.highValueThreshold !== null &&
    stockValue !== null &&
    stockValue >= input.highValueThreshold &&
    (res.status === "slow" || res.status === "non_moving" || (res.daysOfCover !== null && res.daysOfCover > input.excessCoverageDays))
  ) {
    flags.push({
      code: "high_value_slow",
      label: "High value, low sales",
      rule: `Stock value is in the top 10% of this workspace (≥ ${fmt(input.highValueThreshold, 0)}) while sales are slow relative to stock.`,
      severity: "high",
    });
  }

  return res;
}

/** Value at the given percentile (0–1) of positive numbers; null when there are fewer than 10 values. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length < 10) return null;
  const idx = Math.min(v.length - 1, Math.floor(p * v.length));
  return v[idx];
}

// ---------------------------------------------------------------- data-quality checks

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/(\d)\s*(mm|sq|sqmm|amp|a|w|v|m|kg|ltr|l|inch|in)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

export type DuplicateCandidate = { productIds: string[]; reason: string };

/** Finds possible duplicate products: identical normalised names, same barcode, or same manufacturer part number. */
export function findPossibleDuplicates(
  products: { id: string; sku: string; name: string; barcode: string | null; mpn: string | null; brand: string | null }[],
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const group = (keyFn: (p: (typeof products)[number]) => string | null, reason: (k: string) => string) => {
    const m = new Map<string, string[]>();
    for (const p of products) {
      const k = keyFn(p);
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), p.id]);
    }
    for (const [k, ids] of m) if (ids.length > 1) out.push({ productIds: ids, reason: reason(k) });
  };
  group((p) => (p.name.trim().length >= 4 ? normalizeName(p.name) : null), () => "Same description after normalising spacing, case and word order");
  group((p) => (p.mpn ? `${(p.brand ?? "").toLowerCase()}|${p.mpn.toLowerCase().replace(/[^a-z0-9]/g, "")}` : null), () => "Same brand and manufacturer part number");
  return dedupeGroups(out);
}

function dedupeGroups(groups: DuplicateCandidate[]): DuplicateCandidate[] {
  const seen = new Set<string>();
  return groups.filter((g) => {
    const key = [...g.productIds].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type CostChange = { latest: number; median: number; changePct: number };

/** Flags when the latest purchase cost differs from the median of earlier costs by more than `thresholdPct`. */
export function suspiciousCostChange(costsOldestFirst: number[], thresholdPct = 40): CostChange | null {
  const costs = costsOldestFirst.filter((c) => c > 0);
  if (costs.length < 3) return null;
  const latest = costs[costs.length - 1];
  const prior = costs.slice(0, -1).sort((a, b) => a - b);
  const median = prior.length % 2 ? prior[(prior.length - 1) / 2] : (prior[prior.length / 2 - 1] + prior[prior.length / 2]) / 2;
  const changePct = ((latest - median) / median) * 100;
  return Math.abs(changePct) >= thresholdPct ? { latest, median, changePct: Math.round(changePct * 10) / 10 } : null;
}

function fmt(n: number, dp = 3) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: dp }).format(n);
}
function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round3(n: number) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
