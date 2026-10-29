import { normalizeUnit } from "../units";

export type ParseResult<T> = { ok: true; value: T | null } | { ok: false; error: string };

/**
 * Parses numbers as written in Indian business spreadsheets:
 *   "1,23,456.50", "₹ 2,499", "Rs. 120", "(150)" → -150, "12 Nos" → 12 (unit returned separately), "-" → empty.
 */
export function parseNumber(raw: string | null | undefined): ParseResult<number> & { unitHint?: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let s = String(raw).trim();
  if (s === "" || s === "-" || s === "—" || s.toLowerCase() === "nil" || s.toLowerCase() === "n/a") return { ok: true, value: null };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/\s*(dr|cr)\.?$/i, (m) => {
    if (/cr/i.test(m)) negative = !negative;
    return "";
  });
  let unitHint: string | undefined;
  const unitMatch = s.match(/^([-+]?[\d,]*\.?\d+(?:e[-+]?\d+)?)\s*([a-zA-Z.]{1,10})$/i);
  if (unitMatch) {
    s = unitMatch[1];
    unitHint = normalizeUnit(unitMatch[2]) ?? undefined;
  }
  s = s.replace(/,/g, "").replace(/\s+/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { ok: false, error: `"${String(raw).slice(0, 40)}" is not a number` };
  let n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: `"${String(raw).slice(0, 40)}" is not a number` };
  if (Math.abs(n) > 1e12) return { ok: false, error: "Number is too large" };
  if (negative) n = -n;
  return { ok: true, value: n, unitHint };
}

export type DateOrder = "dmy" | "mdy" | "ymd";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Parses dates; numeric day/month order follows `order` (Indian files are day-first by default). */
export function parseDate(raw: string | null | undefined, order: DateOrder = "dmy"): ParseResult<string> {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { ok: true, value: null };
  const s = String(raw).trim();

  // ISO from Excel date cells (we convert them to YYYY-MM-DD when parsing the workbook)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return build(+m[1], +m[2], +m[3], s);

  // Excel serial date stored as a number (1900 date system)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return build(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), s);
    }
  }

  // 05-Sep-2026, 5 Sep 2026, 5-Sept-26, Sep 5 2026
  m = s.match(/^(\d{1,2})[\s\-/.]+([a-zA-Z]{3,9})[\s\-/.,]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    if (mon) return build(year(+m[3]), mon, +m[1], s);
  }
  m = s.match(/^([a-zA-Z]{3,9})[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon) return build(year(+m[3]), mon, +m[2], s);
  }

  // 05/09/2026, 5-9-26, 05.09.2026, 2026/09/05
  m = s.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
  if (m) {
    const [a, b, c] = [+m[1], +m[2], +m[3]];
    if (m[1].length === 4) return build(a, b, c, s);
    if (order === "mdy") return build(year(c), a, b, s);
    return build(year(c), b, a, s);
  }
  return { ok: false, error: `"${s.slice(0, 40)}" is not a recognised date` };
}

function year(y: number) {
  return y < 100 ? 2000 + y : y;
}

function build(y: number, mo: number, d: number, raw: string): ParseResult<string> {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return { ok: false, error: `"${raw.slice(0, 40)}" is not a valid date` };
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return { ok: false, error: `"${raw.slice(0, 40)}" is not a valid date` };
  return { ok: true, value: date.toISOString().slice(0, 10) };
}

/**
 * Looks at a sample of a date column to decide day-first vs month-first.
 * Returns "ambiguous" when every value has day and month ≤ 12 — the user should confirm.
 */
export function detectDateOrder(samples: string[]): { order: DateOrder; ambiguous: boolean } {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  let numericSamples = 0;
  for (const raw of samples) {
    const m = String(raw ?? "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m) continue;
    numericSamples++;
    if (+m[1] > 12) dayFirstEvidence++;
    if (+m[2] > 12) monthFirstEvidence++;
  }
  if (monthFirstEvidence > 0 && dayFirstEvidence === 0) return { order: "mdy", ambiguous: false };
  if (dayFirstEvidence > 0) return { order: "dmy", ambiguous: false };
  return { order: "dmy", ambiguous: numericSamples > 0 };
}

export function cleanText(raw: string | null | undefined, max = 300): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function cleanCode(raw: string | null | undefined): string | null {
  const s = cleanText(raw, 80);
  if (!s) return null;
  // Excel often turns numeric codes into "12345.0"
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s;
}

/** Excel/Sheets formula injection guard for CSV exports: prefix risky leading characters. */
export function csvSafe(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvSafe).join(","), ...rows.map((r) => r.map(csvSafe).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
