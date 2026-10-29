import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Numeric = string | number | Decimal | null | undefined;

export function dec(v: Numeric): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v);
}

/** Money rounding rule: half-up to 2 decimals, applied per line before summing. */
export function money(v: Numeric): Decimal {
  return dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function lineTotal(qty: Numeric, unitPrice: Numeric, discount: Numeric = 0): Decimal {
  return money(dec(qty).times(dec(unitPrice)).minus(dec(discount)));
}

export function sumMoney(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export function toNumber(v: Numeric): number {
  return dec(v).toNumber();
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** ₹1,23,456.50 — Indian digit grouping. */
export function formatINR(v: Numeric, opts: { whole?: boolean } = {}): string {
  const n = toNumber(v);
  return opts.whole ? inrWhole.format(n) : inr.format(n);
}

/** ₹12.3 L / ₹1.2 Cr for compact KPI display. */
export function formatINRCompact(v: Numeric): string {
  const n = toNumber(v);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inrWhole.format(n);
}

export function formatQty(v: Numeric): string {
  return qtyFmt.format(toNumber(v));
}
