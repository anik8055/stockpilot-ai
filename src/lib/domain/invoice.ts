import { z } from "zod";
import { parseDate, parseNumber } from "./imports/values";
import { normalizeName } from "./slow-moving";
import { normalizeUnit } from "./units";

/**
 * Supplier invoice structuring and checks.
 *
 * The deterministic parser reads the text layer line by line. A line item is accepted only when the numbers on it
 * reconcile (quantity × rate ≈ amount, optionally after discount or tax), so a misread number produces "no line"
 * rather than a wrong line. Everything extracted is shown for review before any stock changes.
 */

export const extractedLineSchema = z.object({
  description: z.string().min(1).max(300),
  supplier_code: z.string().max(80).nullable().optional(),
  hsn: z.string().max(12).nullable().optional(),
  quantity: z.number().positive().max(1e7).nullable(),
  unit: z.string().max(20).nullable().optional(),
  unit_price: z.number().min(0).max(1e9).nullable(),
  discount_amount: z.number().min(0).max(1e9).nullable().optional(),
  tax_rate: z.number().min(0).max(100).nullable().optional(),
  line_total: z.number().min(0).max(1e10).nullable(),
});

export const extractedInvoiceSchema = z.object({
  supplier_name: z.string().max(200).nullable(),
  supplier_gstin: z.string().max(20).nullable(),
  invoice_number: z.string().max(60).nullable(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  subtotal: z.number().min(0).max(1e11).nullable(),
  tax_total: z.number().min(0).max(1e11).nullable(),
  total: z.number().min(0).max(1e11).nullable(),
  lines: z.array(extractedLineSchema).max(500),
});

export type ExtractedLine = z.infer<typeof extractedLineSchema>;
export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const NUM_TOKEN = /^\(?-?(?:₹|rs\.?)?[\d,]*\.?\d+\)?%?$/i;

function num(tok: string): number | null {
  const p = parseNumber(tok.replace(/%$/, ""));
  return p.ok ? p.value : null;
}

function close(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * 0.005);
}

function lastNumberOn(line: string): number | null {
  const toks = line.split(/\s+/).filter((t) => NUM_TOKEN.test(t) && !t.endsWith("%"));
  for (let i = toks.length - 1; i >= 0; i--) {
    const n = num(toks[i]);
    if (n !== null) return n;
  }
  return null;
}

export function parseInvoiceText(text: string): ExtractedInvoice {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = lines.join("\n");

  const gstins = [...new Set(joined.toUpperCase().match(GSTIN_RE) ?? [])];
  const invNo = joined.match(/\b(?:tax\s+)?(?:invoice|inv|bill)\s*(?:no\.?|number|#)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\/\-]{1,40})/i);
  const dateMatch = joined.match(/\b(?:invoice\s*date|bill\s*date|dated|date)\s*[:\-.]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\s\-][A-Za-z]{3,9}[\s\-,]+\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  const date = dateMatch ? parseDate(dateMatch[1]) : null;

  let total: number | null = null;
  let subtotal: number | null = null;
  let tax = 0;
  let taxSeen = false;
  for (const l of lines) {
    const low = l.toLowerCase();
    if (/\b(grand\s+total|invoice\s+total|total\s+amount|net\s+payable|amount\s+payable|total\s+invoice\s+value|net\s+amount)\b/.test(low)) {
      const n = lastNumberOn(l);
      if (n !== null) total = n;
    } else if (/\b(taxable\s+(value|amount)|sub\s*-?\s*total)\b/.test(low)) {
      const n = lastNumberOn(l);
      if (n !== null) subtotal = n;
    } else if (/^(cgst|sgst|igst|utgst|gst)\b/.test(low) || /\b(add\s*:?\s*)?(cgst|sgst|igst)\b.*\d/.test(low)) {
      const n = lastNumberOn(l);
      if (n !== null && !/^\d+(\.\d+)?%$/.test(l.split(" ").pop() ?? "")) {
        tax += n;
        taxSeen = true;
      }
    }
  }

  const items: ExtractedLine[] = [];
  let pending: string[] = [];
  let inTable = false;
  for (const l of lines) {
    const low = l.toLowerCase();
    if (/\b(description|particulars|item)\b/.test(low) && /\b(qty|quantity)\b/.test(low)) {
      inTable = true;
      pending = [];
      continue;
    }
    if (/\b(grand\s+total|sub\s*-?\s*total|taxable\s+value|total\s+amount|amount\s+in\s+words)\b/.test(low)) {
      inTable = false;
      pending = [];
      continue;
    }
    const item = parseItemLine(l, pending);
    if (item) {
      items.push(item);
      pending = [];
      inTable = true;
    } else if (inTable) {
      pending.push(l);
      if (pending.length > 3) pending.shift();
    }
  }

  const first = lines.find((l) => !/^(tax\s+)?invoice$|^original|^duplicate|^gstin|^bill\s+of\s+supply/i.test(l) && /[a-z]/i.test(l));
  return {
    supplier_name: first ? first.slice(0, 200) : null,
    supplier_gstin: gstins[0] ?? null,
    invoice_number: invNo ? invNo[1].replace(/[.,]$/, "") : null,
    invoice_date: date && date.ok ? date.value : null,
    subtotal,
    tax_total: taxSeen ? Math.round(tax * 100) / 100 : null,
    total,
    lines: items,
  };
}

/** Tries to read one invoice row. Returns null unless the numbers reconcile. */
export function parseItemLine(line: string, pendingDescription: string[] = []): ExtractedLine | null {
  const toks = line.split(" ");
  const numeric: { i: number; v: number; pct: boolean }[] = [];
  toks.forEach((t, i) => {
    if (NUM_TOKEN.test(t)) {
      const v = num(t);
      if (v !== null) numeric.push({ i, v, pct: t.endsWith("%") });
    }
  });
  const plain = numeric.filter((n) => !n.pct);
  if (plain.length < 3) return null;
  const amount = plain[plain.length - 1];
  const pcts = numeric.filter((n) => n.pct).map((n) => n.v);

  // candidate (qty, rate) pairs in reading order, before the amount
  const before = plain.slice(0, -1);
  for (let a = 0; a < before.length; a++) {
    for (let b = a + 1; b < before.length; b++) {
      const q = before[a].v;
      const r = before[b].v;
      if (q <= 0 || q > 1e6 || r < 0) continue;
      const gross = q * r;
      const others = before.filter((_, k) => k !== a && k !== b && k > b);
      let discount: number | null = null;
      let taxRate: number | null = null;
      let ok = close(gross, amount.v);
      if (!ok) {
        for (const d of others) {
          if (close(gross - d.v, amount.v)) {
            discount = d.v;
            ok = true;
            break;
          }
        }
      }
      if (!ok) {
        for (const p of [...pcts, ...others.map((o) => o.v).filter((v) => [5, 12, 18, 28, 3, 0.25].includes(v))]) {
          if (close(gross * (1 + p / 100), amount.v)) {
            taxRate = p;
            ok = true;
            break;
          }
          if (close(gross * (1 - p / 100), amount.v)) {
            discount = Math.round(gross * (p / 100) * 100) / 100;
            ok = true;
            break;
          }
        }
      }
      if (!ok) continue;
      if (taxRate === null && pcts.length) taxRate = pcts.find((p) => [0, 5, 12, 18, 28].includes(p)) ?? null;
      const qtyIdx = before[a].i;
      const unitTok = toks[qtyIdx + 1];
      const unit = unitTok && !NUM_TOKEN.test(unitTok) && /^[a-z.]{1,8}$/i.test(unitTok) && normalizeUnit(unitTok) && UNITISH.has(normalizeUnit(unitTok)!) ? normalizeUnit(unitTok) : null;
      const hsnIdx = toks.findIndex((t, i) => i < qtyIdx && /^\d{4}(\d{2}){0,2}$/.test(t));
      const hsnTok = hsnIdx >= 0 ? toks[hsnIdx] : undefined;
      // Description = everything before the quantity except the HSN code (keeps sizes like "2.5 sqmm")
      const textToks = toks.slice(0, qtyIdx).filter((t, i) => i !== hsnIdx && t !== "—" && t !== "-");
      const descParts = [...pendingDescription, textToks.join(" ")].join(" ").replace(/^\d{1,3}[.)]?\s+/, "").trim();
      const codes = [...pendingDescription.join(" ").split(" "), ...textToks].filter(looksLikeCode);
      if (!descParts && !codes.length) continue;
      const code = codes[codes.length - 1] ?? null;
      const withoutCode = code ? descParts.split(" ").filter((w) => w !== code).join(" ").trim() : descParts;
      return {
        description: (withoutCode || descParts || codes.join(" ")).slice(0, 300),
        supplier_code: code,
        hsn: hsnTok ?? null,
        quantity: q,
        unit,
        unit_price: r,
        discount_amount: discount,
        tax_rate: taxRate,
        line_total: amount.v,
      };
    }
  }
  return null;
}

const UNITISH = new Set(["pcs", "box", "pack", "set", "pair", "m", "kg", "g", "l", "ml", "roll", "coil", "dozen", "bundle"]);

/** Supplier/part codes: letters and digits, with an upper-case letter or a separator. Sizes like "500g", "6pc", "2.5mm" are not codes. */
export function looksLikeCode(t: string): boolean {
  if (t.length < 3 || t.length > 40) return false;
  // Upper-case codes with separators, digits optional: HW-SCR-SET, KV/W25
  if (/^[A-Z0-9]+(?:[-\/][A-Z0-9]+)+$/.test(t) && /[A-Z]/.test(t)) return true;
  if (!/[a-z]/i.test(t) || !/\d/.test(t) || !/^[A-Za-z0-9][A-Za-z0-9\-\/._]*$/.test(t)) return false;
  if (/^\d{1,2}[\/\-.]\d{1,2}/.test(t)) return false; // dates
  if (/^\d+(\.\d+)?[a-z]{1,5}$/i.test(t)) return false; // measurements: 500g, 6pc, 2.5MM, 16A
  return /[A-Z]/.test(t) || /[-\/]/.test(t);
}

// ------------------------------------------------------------------ arithmetic checks

export type InvoiceCheck = { level: "ok" | "warning" | "error"; message: string; field?: string; line?: number };

export function checkInvoice(inv: Pick<ExtractedInvoice, "subtotal" | "tax_total" | "total" | "lines">): { checks: InvoiceCheck[]; linesTotal: number; consistent: boolean } {
  const checks: InvoiceCheck[] = [];
  let linesTotal = 0;
  inv.lines.forEach((l, idx) => {
    const n = idx + 1;
    if (l.quantity === null || l.unit_price === null || l.line_total === null) {
      checks.push({ level: "warning", line: n, message: `Line ${n}: quantity, rate or amount is missing.` });
    } else {
      const expected = l.quantity * l.unit_price - (l.discount_amount ?? 0);
      const withTax = expected * (1 + (l.tax_rate ?? 0) / 100);
      if (!close(expected, l.line_total) && !close(withTax, l.line_total)) {
        checks.push({ level: "error", line: n, message: `Line ${n}: ${l.quantity} × ${l.unit_price}${l.discount_amount ? ` − ${l.discount_amount}` : ""} = ${round2(expected)}, but the amount says ${l.line_total}.` });
      }
    }
    linesTotal += l.line_total ?? 0;
  });
  linesTotal = round2(linesTotal);
  let consistent = checks.every((c) => c.level !== "error");
  if (inv.lines.length === 0) {
    checks.push({ level: "warning", message: "No line items could be read. Add them on the review screen." });
    consistent = false;
  }
  const base = inv.subtotal ?? null;
  if (base !== null && inv.lines.length) {
    const linesIncludeTax = inv.total !== null && close(linesTotal, inv.total) && !close(linesTotal, base);
    if (!linesIncludeTax && !close(linesTotal, base)) {
      checks.push({ level: "error", field: "subtotal", message: `Lines add up to ${linesTotal}, but the taxable value / subtotal is ${base}.` });
      consistent = false;
    }
  }
  if (base !== null && inv.tax_total !== null && inv.total !== null) {
    if (Math.abs(base + inv.tax_total - inv.total) > 1.01) {
      checks.push({ level: "error", field: "total", message: `Subtotal ${base} + tax ${inv.tax_total} = ${round2(base + inv.tax_total)}, but the invoice total is ${inv.total} (round-off up to ₹1 is allowed).` });
      consistent = false;
    }
  } else if (inv.total !== null && inv.lines.length && base === null) {
    if (!close(linesTotal, inv.total) && !(inv.tax_total !== null && Math.abs(linesTotal + inv.tax_total - inv.total) <= 1.01)) {
      checks.push({ level: "warning", field: "total", message: `Lines add up to ${linesTotal}; invoice total is ${inv.total}. Check for missing lines, freight or tax.` });
    }
  }
  if (inv.total === null) checks.push({ level: "warning", field: "total", message: "Invoice total not found." });
  if (consistent && inv.lines.length) checks.push({ level: "ok", message: "Line amounts and totals reconcile." });
  return { checks, linesTotal, consistent };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------------ matching

export type MatchCandidate = { id: string; sku: string; name: string; mpn: string | null; barcode: string | null; codes: { value: string; supplierId: string | null }[] };
export type MatchResult = { productId: string | null; method: "supplier_code" | "sku" | "alias" | "mpn" | "name" | "suggested" | null; score: number; suggestions: { productId: string; score: number }[] };

/**
 * Conservative matching: only exact identifiers (this supplier's code, SKU, alias, part number, exact normalised
 * name) auto-match. Fuzzy name similarity is offered as a suggestion that the user must pick.
 */
export function matchLine(line: Pick<ExtractedLine, "description" | "supplier_code">, products: MatchCandidate[], supplierId: string | null): MatchResult {
  const tokens = new Set(`${line.supplier_code ?? ""} ${line.description}`.split(/[\s,;()]+/).filter((t) => t.length >= 3).map((t) => t.toLowerCase()));
  if (supplierId) {
    const p = products.find((x) => x.codes.some((c) => c.supplierId === supplierId && tokens.has(c.value.toLowerCase())));
    if (p) return { productId: p.id, method: "supplier_code", score: 1, suggestions: [] };
  }
  const bySku = products.filter((x) => tokens.has(x.sku.toLowerCase()));
  if (bySku.length === 1) return { productId: bySku[0].id, method: "sku", score: 1, suggestions: [] };
  const byAlias = products.filter((x) => x.codes.some((c) => c.supplierId === null && tokens.has(c.value.toLowerCase())));
  if (byAlias.length === 1) return { productId: byAlias[0].id, method: "alias", score: 1, suggestions: [] };
  const byMpn = products.filter((x) => x.mpn && tokens.has(x.mpn.toLowerCase()));
  if (byMpn.length === 1) return { productId: byMpn[0].id, method: "mpn", score: 0.95, suggestions: [] };
  const norm = normalizeName(line.description);
  const withCode = line.supplier_code ? normalizeName(`${line.description} ${line.supplier_code}`) : null;
  const byName = products.filter((x) => {
    const n = normalizeName(x.name);
    return n === norm || (withCode !== null && n === withCode);
  });
  if (byName.length === 1) return { productId: byName[0].id, method: "name", score: 0.9, suggestions: [] };

  const want = new Set(norm.split(" ").filter((w) => w.length > 1));
  const scored = products
    .map((x) => {
      const have = new Set(normalizeName(x.name).split(" ").filter((w) => w.length > 1));
      const inter = [...want].filter((w) => have.has(w)).length;
      const union = new Set([...want, ...have]).size || 1;
      return { productId: x.id, score: Math.round((inter / union) * 100) / 100 };
    })
    .filter((s) => s.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { productId: null, method: scored.length ? "suggested" : null, score: scored[0]?.score ?? 0, suggestions: scored };
}
