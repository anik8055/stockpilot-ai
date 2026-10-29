import type { DataQuality, DemandStats, Trend } from "./demand";

/**
 * Reorder recommendation engine (deterministic).
 *
 *   inventory position = on hand + inbound (open, sent POs not yet received) − reserved
 *   reorder point (ROP) = average daily demand × lead time (days) + safety stock      [never below min stock]
 *   target level        = average daily demand × (lead time + target coverage days) + safety stock  [capped at max stock]
 *   suggested quantity  = target level − inventory position, when position ≤ ROP
 *                         → rounded up to whole units, then up to MOQ and pack-size multiples; never negative.
 *
 * Inbound supply is counted exactly once (inside inventory position). Draft POs are not inbound.
 * When demand cannot be measured, explicit fallbacks are used and the result is labelled provisional.
 */

export type ReorderMethod = "demand" | "provisional_demand" | "min_max" | "none";
export type Urgency = "out_of_stock" | "critical" | "reorder" | "watch" | "ok" | "not_applicable";

export type ReorderInput = {
  active: boolean;
  onHand: number;
  inbound: number;
  reserved: number;
  demand: DemandStats;
  leadTimeDays: number;
  leadTimeSource: "product" | "supplier_product" | "supplier" | "business_default";
  /** Explicit safety stock (base units). When null, safety = ADD × defaultSafetyDays. */
  safetyStock: number | null;
  defaultSafetyDays: number;
  minStock: number | null;
  maxStock: number | null;
  targetCoverageDays: number;
  moq: number | null;
  packSize: number | null;
  unitCost: number | null;
};

export type ReorderResult = {
  eligible: boolean;
  method: ReorderMethod;
  provisional: boolean;
  urgency: Urgency;
  averageDailyDemand: number | null;
  trend: Trend;
  onHand: number;
  inbound: number;
  reserved: number;
  inventoryPosition: number;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number | null;
  targetLevel: number | null;
  suggestedQty: number;
  estimatedCost: number | null;
  daysOfStock: number | null;
  stockoutBeforeArrival: boolean;
  quality: DataQuality;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  warnings: string[];
};

export function recommendReorder(input: ReorderInput): ReorderResult {
  const reasons: string[] = [];
  const warnings: string[] = [...input.demand.notes];
  const onHand = r3(input.onHand);
  const inbound = r3(Math.max(0, input.inbound));
  const reserved = r3(Math.max(0, input.reserved));
  const position = r3(onHand + inbound - reserved);
  const lt = Math.max(0, input.leadTimeDays);
  const add = input.demand.averageDailyDemand;

  const base: ReorderResult = {
    eligible: false,
    method: "none",
    provisional: false,
    urgency: "not_applicable",
    averageDailyDemand: add,
    trend: input.demand.trend,
    onHand,
    inbound,
    reserved,
    inventoryPosition: position,
    leadTimeDays: lt,
    safetyStock: 0,
    reorderPoint: null,
    targetLevel: null,
    suggestedQty: 0,
    estimatedCost: null,
    daysOfStock: null,
    stockoutBeforeArrival: false,
    quality: input.demand.quality,
    confidence: "low",
    reasons,
    warnings,
  };

  if (!input.active) {
    reasons.push("Product is inactive/discontinued — not recommended for reorder.");
    return base;
  }
  if (onHand < 0) warnings.push("Recorded stock is negative — check the latest stock snapshot.");

  let method: ReorderMethod;
  let demandForCalc: number | null = null;
  const q = input.demand.quality;
  if (add !== null && (q === "good" || q === "limited")) {
    method = "demand";
    demandForCalc = add;
  } else if (add !== null && add > 0 && input.demand.observedDays >= 7) {
    method = "provisional_demand";
    demandForCalc = add;
    reasons.push(`Provisional: based on only ${input.demand.observedDays} day(s) of sales history.`);
  } else if (input.minStock !== null && input.minStock > 0) {
    method = "min_max";
    reasons.push("Provisional: not enough sales history, so the configured minimum/maximum stock levels are used.");
  } else {
    reasons.push(
      q === "none"
        ? "No sales history imported and no minimum stock set — cannot recommend a quantity."
        : "Sales history is too short and no minimum stock is set — cannot recommend a quantity.",
    );
    return { ...base, urgency: onHand <= 0 ? "out_of_stock" : "not_applicable" };
  }

  let safety: number;
  let rop: number;
  let target: number;

  if (method === "min_max") {
    safety = input.safetyStock ?? 0;
    rop = Math.max(input.minStock!, safety);
    target = input.maxStock !== null && input.maxStock >= rop ? input.maxStock : rop;
    reasons.push(
      `Reorder point = minimum stock ${fmt(input.minStock!)}; order up to ${input.maxStock !== null ? `maximum stock ${fmt(target)}` : `minimum stock ${fmt(target)}`}.`,
    );
  } else {
    const d = demandForCalc!;
    safety = input.safetyStock ?? r3(d * input.defaultSafetyDays);
    rop = d * lt + safety;
    reasons.push(
      `Reorder point = ${fmt(d, 2)}/day × ${lt} day lead time (${leadLabel(input.leadTimeSource)}) + ${fmt(safety)} safety stock = ${fmt(rop)}.`,
    );
    if (input.minStock !== null && input.minStock > rop) {
      rop = input.minStock;
      reasons.push(`Raised to the configured minimum stock of ${fmt(input.minStock)}.`);
    }
    target = d * (lt + input.targetCoverageDays) + safety;
    let targetNote = `Target = ${fmt(d, 2)}/day × (${lt} + ${input.targetCoverageDays} coverage days) + safety = ${fmt(target)}.`;
    if (input.maxStock !== null && target > input.maxStock) {
      target = Math.max(input.maxStock, rop);
      targetNote += ` Capped at maximum stock ${fmt(target)}.`;
    }
    if (target < rop) target = rop;
    reasons.push(targetNote);
  }

  rop = r3(rop);
  target = r3(target);
  const needs = position <= rop && target > position;
  let qty = 0;
  if (needs) {
    qty = Math.ceil(target - position - 1e-9);
    const moq = input.moq && input.moq > 0 ? input.moq : null;
    const pack = input.packSize && input.packSize > 0 ? input.packSize : null;
    if (moq && qty < moq) {
      reasons.push(`Rounded up to supplier minimum order quantity ${fmt(moq)}.`);
      qty = moq;
    }
    if (pack) {
      const packed = Math.ceil(qty / pack - 1e-9) * pack;
      if (packed !== qty) reasons.push(`Rounded up to a multiple of pack size ${fmt(pack)}.`);
      qty = packed;
    }
    qty = r3(Math.max(0, qty));
  }

  const positionText = `Inventory position ${fmt(position)} = on hand ${fmt(onHand)}${inbound ? ` + inbound ${fmt(inbound)}` : ""}${reserved ? ` − reserved ${fmt(reserved)}` : ""}.`;
  reasons.unshift(positionText);
  if (needs) reasons.push(`Position is at or below the reorder point → suggest ordering ${fmt(qty)}.`);
  else reasons.push("Position is above the reorder point → no order needed now.");

  const usable = onHand - reserved;
  const daysOfStock = demandForCalc && demandForCalc > 0 ? r1(Math.max(0, usable) / demandForCalc) : null;
  const stockoutBeforeArrival = daysOfStock !== null && daysOfStock < lt && inbound === 0;

  let urgency: Urgency;
  if (onHand <= 0) urgency = "out_of_stock";
  else if (needs && stockoutBeforeArrival) urgency = "critical";
  else if (needs) urgency = "reorder";
  else if (position <= rop * 1.25) urgency = "watch";
  else urgency = "ok";

  let estimatedCost: number | null = null;
  if (qty > 0) {
    if (input.unitCost !== null && input.unitCost >= 0) estimatedCost = Math.round(qty * input.unitCost * 100) / 100;
    else warnings.push("No purchase cost recorded — estimated cost unavailable.");
  }

  const provisional = method !== "demand";
  const confidence: ReorderResult["confidence"] = provisional ? "low" : q === "good" && !input.demand.intermittent ? "high" : "medium";

  return {
    ...base,
    eligible: true,
    method,
    provisional,
    urgency,
    safetyStock: r3(safety),
    reorderPoint: rop,
    targetLevel: target,
    suggestedQty: qty,
    estimatedCost,
    daysOfStock,
    stockoutBeforeArrival,
    confidence,
  };
}

function leadLabel(src: ReorderInput["leadTimeSource"]) {
  return { product: "product setting", supplier_product: "supplier item setting", supplier: "supplier default", business_default: "business default" }[src];
}

function fmt(n: number, dp = 3) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: dp }).format(n);
}

function r3(n: number) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
function r1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
