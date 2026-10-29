/**
 * Units of measure. Different units are never assumed interchangeable: a conversion is only possible when the
 * product's base unit matches, or an explicit conversion (1 box = 10 pcs) has been configured for that product.
 */

export const COMMON_UNITS = ["pcs", "box", "pack", "set", "pair", "m", "kg", "g", "l", "ml", "roll", "coil", "dozen", "bundle", "nos"] as const;

const UNIT_ALIASES: Record<string, string> = {
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", nos: "pcs", no: "pcs", "no.": "pcs", "nos.": "pcs", each: "pcs", ea: "pcs", unit: "pcs", units: "pcs",
  box: "box", boxes: "box", bx: "box",
  pack: "pack", packs: "pack", pkt: "pack", packet: "pack", packets: "pack", pk: "pack",
  set: "set", sets: "set",
  pair: "pair", pairs: "pair", pr: "pair",
  m: "m", mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  l: "l", ltr: "l", ltrs: "l", litre: "l", liter: "l", litres: "l", liters: "l",
  ml: "ml",
  roll: "roll", rolls: "roll",
  coil: "coil", coils: "coil",
  dozen: "dozen", dz: "dozen", doz: "dozen",
  bundle: "bundle", bundles: "bundle", bdl: "bundle",
};

/** Normalises spelling variants ("Nos", "MTR", "Pkt") to a canonical unit code. Unknown units are lower-cased as-is. */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (!key) return null;
  return UNIT_ALIASES[key] ?? key;
}

export type UnitConversion = { unitCode: string; factorToBase: number };

export type ConversionResult =
  | { ok: true; baseQuantity: number; factor: number }
  | { ok: false; reason: string };

/** Converts quantity in `unit` to the product's base unit using only explicitly configured conversions. */
export function toBaseQuantity(
  quantity: number,
  unit: string | null | undefined,
  baseUnit: string,
  conversions: UnitConversion[],
): ConversionResult {
  if (!Number.isFinite(quantity)) return { ok: false, reason: "Quantity is not a number" };
  const u = normalizeUnit(unit) ?? normalizeUnit(baseUnit)!;
  const base = normalizeUnit(baseUnit)!;
  if (u === base) return { ok: true, baseQuantity: round3(quantity), factor: 1 };
  const conv = conversions.find((c) => normalizeUnit(c.unitCode) === u);
  if (!conv) {
    return { ok: false, reason: `No conversion configured from "${u}" to base unit "${base}"` };
  }
  if (!(conv.factorToBase > 0)) return { ok: false, reason: `Invalid conversion factor for "${u}"` };
  return { ok: true, baseQuantity: round3(quantity * conv.factorToBase), factor: conv.factorToBase };
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
