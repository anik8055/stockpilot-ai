import { normalizeUnit, toBaseQuantity, type UnitConversion } from "../units";
import { fieldsFor, type ImportKind } from "./fields";
import type { Mapping } from "./mapping";
import { cleanCode, cleanText, parseDate, parseNumber, type DateOrder } from "./values";

export type ProductRef = { id: string; sku: string; name: string; baseUnit: string; conversions: UnitConversion[] };

export interface ProductLookup {
  /** Resolve by SKU, alias/supplier code or barcode (case-insensitive). */
  byCode(code: string): ProductRef | null;
  /** Resolve by exact normalised name; returns "ambiguous" if several products share it. */
  byName(name: string): ProductRef | "ambiguous" | null;
}

export type RowIssue = { field?: string; code: string; message: string; severity: "error" | "warning"; rawValue?: string };

export type NormalizedRow = {
  rowNumber: number;
  status: "valid" | "error" | "skipped";
  record: Record<string, unknown>;
  issues: RowIssue[];
};

export type ValidationOptions = {
  dateOrder?: DateOrder;
  /** Products import: also treat the quantity column as a stock count. */
  recordStock?: boolean;
  today: string;
};

export type ValidationSummary = {
  totalRows: number;
  valid: number;
  errors: number;
  warnings: number;
  skipped: number;
  creates: number;
  updates: number;
  distinctProducts: number;
  dateFrom: string | null;
  dateTo: string | null;
  totalQuantity: number;
  issueCounts: Record<string, number>;
};

export function validateRows(
  kind: ImportKind,
  dataRows: string[][],
  firstDataRowNumber: number,
  mapping: Mapping,
  lookup: ProductLookup,
  opts: ValidationOptions,
): { rows: NormalizedRow[]; summary: ValidationSummary } {
  const fields = fieldsFor(kind);
  const get = (row: string[], key: string): string | null => {
    const idx = mapping[key];
    if (idx === null || idx === undefined) return null;
    const v = row[idx];
    return v === undefined || v === null || String(v).trim() === "" ? null : String(v);
  };

  const out: NormalizedRow[] = [];
  const seenKeys = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const exactRowCounts = new Map<string, number>();

  dataRows.forEach((row, i) => {
    const rowNumber = firstDataRowNumber + i;
    const issues: RowIssue[] = [];
    const record: Record<string, unknown> = {};
    const err = (field: string | undefined, code: string, message: string, rawValue?: string | null) =>
      issues.push({ field, code, message, severity: "error", rawValue: rawValue ?? undefined });
    const warn = (field: string | undefined, code: string, message: string, rawValue?: string | null) =>
      issues.push({ field, code, message, severity: "warning", rawValue: rawValue ?? undefined });

    const mappedValues = fields.map((f) => get(row, f.key)).filter((v) => v !== null);
    if (mappedValues.length === 0) return; // blank row — ignored entirely
    const joined = row.join(" ").toLowerCase();
    const codeCell = get(row, "sku") ?? get(row, "name");
    if (/^\s*(grand\s+)?(sub\s*)?total\b/.test(joined) || (kind !== "suppliers" && !get(row, "sku") && /\btotal\b/.test(String(get(row, "name") ?? "").toLowerCase()))) {
      out.push({ rowNumber, status: "skipped", record: {}, issues: [{ code: "total_row", message: "Looks like a totals row — skipped.", severity: "warning" }] });
      return;
    }
    void codeCell;

    // Generic typed parsing of every mapped field
    for (const f of fields) {
      const raw = get(row, f.key);
      if (raw === null) {
        record[f.key] = null;
        continue;
      }
      switch (f.type) {
        case "text":
          record[f.key] = f.key === "sku" || f.key === "barcode" || f.key === "supplier_sku" || f.key === "mpn" ? cleanCode(raw) : cleanText(raw, f.key === "description" ? 2000 : 300);
          break;
        case "unit":
          record[f.key] = normalizeUnit(raw);
          break;
        case "number":
        case "money":
        case "int": {
          const p = parseNumber(raw);
          if (!p.ok) {
            err(f.key, "invalid_number", `${f.label}: ${p.error}`, raw);
            record[f.key] = null;
          } else {
            record[f.key] = p.value;
            if (p.unitHint && (f.key === "quantity") && !record.unit) record.unit = p.unitHint;
            if (f.type === "int" && p.value !== null && !Number.isInteger(p.value)) {
              err(f.key, "not_integer", `${f.label} must be a whole number of days`, raw);
            }
            if ((f.type === "money" || f.type === "int") && p.value !== null && p.value < 0) {
              err(f.key, "negative", `${f.label} cannot be negative`, raw);
            }
          }
          break;
        }
        case "date": {
          const p = parseDate(raw, opts.dateOrder ?? "dmy");
          if (!p.ok) err(f.key, "invalid_date", `${f.label}: ${p.error}`, raw);
          record[f.key] = p.ok ? p.value : null;
          if (p.ok && p.value && p.value > opts.today) err(f.key, "future_date", `${f.label} ${p.value} is in the future`, raw);
          break;
        }
      }
    }

    for (const f of fields) {
      if (f.required && (record[f.key] === null || record[f.key] === undefined) && !issues.some((x) => x.field === f.key)) {
        if (f.key === "sku" && kind !== "products" && record.name) continue; // name fallback below
        err(f.key, "required", `${f.label} is required`);
      }
    }

    // Kind-specific rules
    if (kind === "products") {
      const skuVal = record.sku as string | null;
      if (skuVal) {
        const key = skuVal.toLowerCase();
        if (seenKeys.has(key)) err("sku", "duplicate_in_file", `SKU "${skuVal}" also appears on row ${seenKeys.get(key)}`, skuVal);
        else seenKeys.set(key, rowNumber);
        record._existing = lookup.byCode(skuVal)?.id ?? null;
      }
      const bc = record.barcode as string | null;
      if (bc) {
        if (seenBarcodes.has(bc)) err("barcode", "duplicate_in_file", `Barcode also appears on row ${seenBarcodes.get(bc)}`, bc);
        else seenBarcodes.set(bc, rowNumber);
      }
      for (const k of ["min_stock", "max_stock", "safety_stock"]) {
        const v = record[k] as number | null;
        if (v !== null && v !== undefined && v < 0) err(k, "negative", `${k.replace("_", " ")} cannot be negative`);
      }
      if (record.min_stock !== null && record.max_stock !== null && (record.max_stock as number) < (record.min_stock as number)) {
        err("max_stock", "max_below_min", "Maximum stock is below minimum stock");
      }
      if (record.lead_time_days !== null && (record.lead_time_days as number) > 365) err("lead_time_days", "out_of_range", "Lead time must be 365 days or less");
      if (!record.base_unit && !record._existing) {
        record.base_unit = "pcs";
        warn("base_unit", "default_unit", 'No unit given — defaulting to "pcs".');
      }
      if (opts.recordStock) {
        if (record.quantity === null) warn("quantity", "no_stock_value", "No stock quantity — stock for this item will not be changed.");
        else if ((record.quantity as number) < 0) warn("quantity", "negative_stock", "Negative stock in source file — check your billing system.");
      }
    }

    if (kind === "stock_snapshot" || kind === "sales" || kind === "purchases") {
      const product = resolveProduct(record, lookup, err);
      if (product) {
        record._productId = product.id;
        record._sku = product.sku;
        const qty = record.quantity as number | null;
        if (qty !== null) {
          const conv = toBaseQuantity(qty, record.unit as string | null, product.baseUnit, product.conversions);
          if (!conv.ok) err("unit", "unit_mismatch", `${conv.reason} for ${product.sku}. Add a unit conversion on the product, or fix the unit.`, (record.unit as string) ?? undefined);
          else {
            record._baseQty = conv.baseQuantity;
            record._unitFactor = conv.factor;
          }
        }
      }

      if (kind === "stock_snapshot") {
        if (product) {
          if (seenKeys.has(product.id)) err("sku", "duplicate_in_file", `${product.sku} also appears on row ${seenKeys.get(product.id)} — a stock file should list each item once`);
          else seenKeys.set(product.id, rowNumber);
        }
        if (typeof record.quantity === "number" && record.quantity < 0) warn("quantity", "negative_stock", "Negative stock in source file — imported as-is; check your billing system.");
      } else {
        const qty = record.quantity as number | null;
        if (qty !== null && qty === 0) {
          out.push({ rowNumber, status: "skipped", record, issues: [...issues, { field: "quantity", code: "zero_qty", message: "Zero quantity — skipped.", severity: "warning" }] });
          return;
        }
        if (qty !== null && qty < 0) {
          out.push({
            rowNumber,
            status: "skipped",
            record,
            issues: [...issues, { field: "quantity", code: "negative_qty", message: "Negative quantity (return / credit note) — not imported as demand.", severity: "warning" }],
          });
          return;
        }
        const price = (kind === "sales" ? record.unit_price : record.unit_cost) as number | null;
        const total = record.line_total as number | null;
        if (qty && price !== null && total !== null) {
          const expected = qty * price;
          if (Math.abs(expected - total) > Math.max(1, Math.abs(total) * 0.02)) {
            warn("line_total", "amount_mismatch", `Quantity × rate = ${round2(expected)} but amount is ${total} (may include tax or discount).`);
          }
        }
        // identical rows are allowed (same item twice on one bill) but flagged
        const sig = JSON.stringify([record.date, record._productId, record.invoice_ref ?? record.bill_ref, qty, price, total]);
        const n = (exactRowCounts.get(sig) ?? 0) + 1;
        exactRowCounts.set(sig, n);
        record._occurrence = n;
        if (n > 1) warn(undefined, "repeated_row", "Identical to an earlier row in this file — imported as a separate line. Remove it if it is a duplicate.");
      }
    }

    if (kind === "suppliers") {
      const name = record.name as string | null;
      if (name) {
        const key = name.toLowerCase();
        if (seenKeys.has(key)) err("name", "duplicate_in_file", `Supplier "${name}" also appears on row ${seenKeys.get(key)}`);
        else seenKeys.set(key, rowNumber);
      }
      const email = record.email as string | null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warn("email", "invalid_email", "Email address looks invalid — it will be saved as entered.");
      const gstin = record.gstin as string | null;
      if (gstin) {
        record.gstin = gstin.toUpperCase().replace(/\s+/g, "");
        if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(record.gstin as string)) {
          warn("gstin", "invalid_gstin", "GSTIN does not look valid (15 characters) — it will not be saved.");
          record.gstin = null;
        }
      }
    }

    const status = issues.some((x) => x.severity === "error") ? "error" : "valid";
    out.push({ rowNumber, status, record, issues });
  });

  return { rows: out, summary: summarize(kind, out) };
}

function resolveProduct(record: Record<string, unknown>, lookup: ProductLookup, err: (f: string, c: string, m: string, raw?: string | null) => void): ProductRef | null {
  const code = record.sku as string | null;
  if (code) {
    const p = lookup.byCode(code);
    if (p) return p;
  }
  const name = record.name as string | null;
  if (name) {
    const p = lookup.byName(name);
    if (p === "ambiguous") {
      err("name", "ambiguous_product", `More than one product is named "${name}" — add the SKU to this row.`, name);
      return null;
    }
    if (p) return p;
  }
  if (code) err("sku", "unknown_product", `SKU "${code}" is not in your product list. Import the product master first, or add it as an alias.`, code);
  else if (name) err("name", "unknown_product", `No product named "${name}". Add the SKU column or import the product master first.`, name);
  return null;
}

function summarize(kind: ImportKind, rows: NormalizedRow[]): ValidationSummary {
  const s: ValidationSummary = {
    totalRows: rows.length,
    valid: 0,
    errors: 0,
    warnings: 0,
    skipped: 0,
    creates: 0,
    updates: 0,
    distinctProducts: 0,
    dateFrom: null,
    dateTo: null,
    totalQuantity: 0,
    issueCounts: {},
  };
  const products = new Set<string>();
  for (const r of rows) {
    if (r.status === "valid") s.valid++;
    else if (r.status === "error") s.errors++;
    else s.skipped++;
    for (const i of r.issues) {
      if (i.severity === "warning") s.warnings++;
      s.issueCounts[i.code] = (s.issueCounts[i.code] ?? 0) + 1;
    }
    if (r.status !== "valid") continue;
    if (kind === "products") {
      if (r.record._existing) s.updates++;
      else s.creates++;
    }
    if (r.record._productId) products.add(r.record._productId as string);
    if (typeof r.record._baseQty === "number") s.totalQuantity += r.record._baseQty as number;
    const d = r.record.date as string | null;
    if (d) {
      if (!s.dateFrom || d < s.dateFrom) s.dateFrom = d;
      if (!s.dateTo || d > s.dateTo) s.dateTo = d;
    }
  }
  s.distinctProducts = kind === "products" ? s.creates + s.updates : products.size;
  s.totalQuantity = Math.round(s.totalQuantity * 1000) / 1000;
  return s;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
