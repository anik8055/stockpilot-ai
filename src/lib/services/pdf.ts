import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatDate } from "@/lib/domain/dates";

/** Small PDF toolkit on top of PDFKit: embedded Noto Sans, Indian number formatting, simple paginated tables. */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const INK = "#10233f";
const MUTED = "#5a6a80";
const LINE = "#c7cfdb";

const num = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const fmtMoney = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : num.format(Number(v)));
export const fmtQty = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : qty.format(Number(v)));

export type Column = { key: string; label: string; width: number; align?: "left" | "right" };

export function createDoc(title: string) {
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: title, Producer: "StockPilot AI", Creator: "StockPilot AI" }, bufferPages: true });
  doc.registerFont("R", path.join(FONT_DIR, "NotoSans-Regular.woff"));
  doc.registerFont("B", path.join(FONT_DIR, "NotoSans-Bold.woff"));
  doc.font("R").fontSize(9).fillColor(INK);
  return doc;
}

export function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export function heading(doc: PDFKit.PDFDocument, text: string, size = 16) {
  doc.font("B").fontSize(size).fillColor(INK).text(text);
  doc.font("R").fontSize(9);
}

export function subheading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.8).font("B").fontSize(11).fillColor(INK).text(text).moveDown(0.3);
  doc.font("R").fontSize(9);
}

export function muted(doc: PDFKit.PDFDocument, text: string, opts: PDFKit.Mixins.TextOptions = {}) {
  doc.fillColor(MUTED).text(text, opts).fillColor(INK);
}

export function ensureSpace(doc: PDFKit.PDFDocument, h: number) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
}

export function table(doc: PDFKit.PDFDocument, columns: Column[], rows: Record<string, string>[], opts: { zebra?: boolean } = {}) {
  const left = doc.page.margins.left;
  const drawHeader = () => {
    const y = doc.y;
    doc.font("B").fontSize(8).fillColor(MUTED);
    let x = left;
    for (const c of columns) {
      doc.text(c.label, x + 3, y, { width: c.width - 6, align: c.align ?? "left" });
      x += c.width;
    }
    const h = Math.max(...columns.map((c) => doc.heightOfString(c.label, { width: c.width - 6 })));
    doc.moveTo(left, y + h + 3).lineTo(left + columns.reduce((s, c) => s + c.width, 0), y + h + 3).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.y = y + h + 6;
    doc.font("R").fontSize(8.5).fillColor(INK);
  };
  drawHeader();
  rows.forEach((r, i) => {
    const h = Math.max(...columns.map((c) => doc.heightOfString(r[c.key] ?? "", { width: c.width - 6 }))) + 5;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (opts.zebra && i % 2 === 1) doc.rect(left, y - 1.5, columns.reduce((s, c) => s + c.width, 0), h).fill("#f5f7fa").fillColor(INK);
    let x = left;
    for (const c of columns) {
      doc.text(r[c.key] ?? "", x + 3, y + 1, { width: c.width - 6, align: c.align ?? "left" });
      x += c.width;
    }
    doc.y = y + h;
  });
  doc.x = left;
}

export function footer(doc: PDFKit.PDFDocument, text: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 30;
    const savedMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("R").fontSize(7.5).fillColor(MUTED).text(`${text}  ·  Page ${i - range.start + 1} of ${range.count}`, doc.page.margins.left, bottom, { width: doc.page.width - doc.page.margins.left * 2, align: "center" });
    doc.page.margins.bottom = savedMargin;
  }
}

export { formatDate };
