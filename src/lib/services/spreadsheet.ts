import ExcelJS from "exceljs";
import Papa from "papaparse";
import { AppError } from "@/lib/errors";

/**
 * Safe spreadsheet parsing. Uploaded files are untrusted:
 *  - type is decided from magic bytes, not the filename;
 *  - formulas are never evaluated — the cached result value (if any) is read as data;
 *  - macros/VBA are ignored (only .xlsx/.csv accepted; .xls/.xlsm binary content is rejected);
 *  - row/column counts are capped to bound memory.
 */

export const MAX_ROWS = 50_000;
export const MAX_COLS = 120;

export type ParsedSheet = { name: string; rows: string[][]; truncated: boolean };
export type ParsedWorkbook = { format: "xlsx" | "csv"; sheets: ParsedSheet[] };

export function detectFormat(buf: Buffer): "xlsx" | "xls" | "csv" | "unknown" {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "xlsx";
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) return "xls";
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) {
    // UTF-16 CSV exports (Excel "Unicode text") contain NULs; accept those via BOM.
    if ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff)) return "csv";
    return "unknown";
  }
  return "csv";
}

export async function parseSpreadsheet(buf: Buffer): Promise<ParsedWorkbook> {
  const fmt = detectFormat(buf);
  if (fmt === "xls") throw new AppError("Old Excel (.xls) files are not supported. Please open the file in Excel and save it as .xlsx or .csv.");
  if (fmt === "unknown") throw new AppError("This file does not look like a CSV or Excel (.xlsx) file.");
  if (fmt === "csv") return { format: "csv", sheets: [parseCsv(buf)] };
  return { format: "xlsx", sheets: await parseXlsx(buf) };
}

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  let s = buf.toString("utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // If it isn't valid UTF-8, fall back to latin1 (common for older Windows exports)
  if (s.includes("�")) s = buf.toString("latin1");
  return s;
}

function parseCsv(buf: Buffer): ParsedSheet {
  const text = decodeText(buf);
  // Empty lines are kept (as empty rows) so rows[i] == file line i+1 for error reporting.
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: "", preview: MAX_ROWS + 1 });
  const rows = (res.data as string[][]).map((r) => {
    const cells = r.slice(0, MAX_COLS).map((c) => (c ?? "").toString());
    return cells.length === 1 && cells[0].trim() === "" ? [] : cells;
  });
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return { name: "CSV", rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

async function parseXlsx(buf: Buffer): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer, { ignoreNodes: ["dataValidations", "conditionalFormatting", "extLst"] } as never);
  } catch {
    throw new AppError("The Excel file could not be read. It may be damaged or password-protected — try saving it again as .xlsx or .csv.");
  }
  const sheets: ParsedSheet[] = [];
  wb.eachSheet((ws) => {
    if (sheets.length >= 20) return;
    const rows: string[][] = [];
    let truncated = false;
    const colCount = Math.min(ws.columnCount || 0, MAX_COLS);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      const out: string[] = [];
      for (let c = 1; c <= colCount; c++) out.push(cellToString(row.getCell(c)));
      // keep rows[i] == spreadsheet row i+1 so error reports reference the real row numbers
      while (rows.length < rowNumber - 1 && rows.length < MAX_ROWS) rows.push([]);
      if (rows.length < MAX_ROWS) rows.push(out);
      else truncated = true;
    });
    sheets.push({ name: ws.name, rows: trimTrailing(rows), truncated });
  });
  if (sheets.length === 0) throw new AppError("The workbook has no sheets.");
  return sheets;
}

function trimTrailing(rows: string[][]): string[][] {
  return rows.map((r) => {
    let end = r.length;
    while (end > 0 && r[end - 1] === "") end--;
    return r.slice(0, end);
  });
}

function cellToString(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) {
      // formula: use cached result only, never evaluate
      const r = o.result as unknown;
      if (r instanceof Date) return isoDate(r);
      if (r === undefined || r === null || (typeof r === "object" && r !== null && "error" in (r as object))) return "";
      return String(r);
    }
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return "";
  }
  return String(v);
}

function isoDate(d: Date): string {
  // Excel dates have no timezone; exceljs gives UTC midnight. Keep the calendar date.
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Builds an .xlsx file from rows (used for templates and error reports). Values are written as plain data. */
export async function buildXlsx(sheets: { name: string; headers: string[]; rows: (string | number | null)[][]; notes?: string[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "StockPilot AI";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    const header = ws.addRow(s.headers);
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    for (const r of s.rows) {
      ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v)));
    }
    ws.columns.forEach((col, i) => {
      const len = Math.max(s.headers[i]?.length ?? 8, ...s.rows.slice(0, 50).map((r) => String(r[i] ?? "").length));
      col.width = Math.min(48, Math.max(10, len + 2));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (s.notes?.length) {
      const notes = wb.addWorksheet(`${s.name.slice(0, 24)} notes`);
      s.notes.forEach((n) => notes.addRow([n]));
      notes.getColumn(1).width = 110;
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
