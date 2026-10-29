import "server-only";
import { createDoc, fmtMoney, fmtQty, table, toBuffer } from "./pdf";

export type SampleInvoiceLine = { description: string; code: string; hsn: string; qty: number; unit: string; rate: number; discount?: number };

/**
 * Generates a synthetic GST tax invoice PDF (text-based) for testing the extraction pipeline.
 * Clearly marked as sample data; never presented as a real supplier's document.
 */
export async function sampleInvoicePdf(opts: {
  supplierName: string;
  supplierGstin: string;
  buyerName: string;
  invoiceNumber: string;
  invoiceDate: string; // DD/MM/YYYY
  lines: SampleInvoiceLine[];
  gstRate?: number;
}): Promise<Buffer> {
  const gst = opts.gstRate ?? 18;
  const doc = createDoc(`Sample invoice ${opts.invoiceNumber}`);
  doc.font("B").fontSize(14).text(opts.supplierName);
  doc.font("R").fontSize(9).text("Plot 12, Sample Industrial Estate, Pune, Maharashtra 411019");
  doc.text(`GSTIN: ${opts.supplierGstin}`);
  doc.fillColor("#9a5b05").text("SAMPLE — synthetic invoice for testing StockPilot. Not a real supplier document.").fillColor("#10233f");
  doc.moveDown(0.6).font("B").fontSize(12).text("Tax Invoice");
  doc.font("R").fontSize(9).text(`Invoice No: ${opts.invoiceNumber}`).text(`Invoice Date: ${opts.invoiceDate}`).text(`Bill To: ${opts.buyerName}`);
  doc.moveDown(0.8);
  let taxable = 0;
  const rows = opts.lines.map((l, i) => {
    const amount = Math.round((l.qty * l.rate - (l.discount ?? 0)) * 100) / 100;
    taxable += amount;
    return {
      n: String(i + 1),
      desc: `${l.description} ${l.code}`,
      hsn: l.hsn,
      qty: fmtQty(l.qty),
      unit: l.unit,
      rate: fmtMoney(l.rate),
      disc: l.discount ? fmtMoney(l.discount) : "",
      amount: fmtMoney(amount),
    };
  });
  table(
    doc,
    [
      { key: "n", label: "Sl", width: 22 },
      { key: "desc", label: "Description of Goods", width: 190 },
      { key: "hsn", label: "HSN", width: 50 },
      { key: "qty", label: "Qty", width: 40, align: "right" },
      { key: "unit", label: "Unit", width: 34 },
      { key: "rate", label: "Rate", width: 62, align: "right" },
      { key: "disc", label: "Disc", width: 50, align: "right" },
      { key: "amount", label: "Amount", width: 67, align: "right" },
    ],
    rows,
  );
  taxable = Math.round(taxable * 100) / 100;
  const half = Math.round(((taxable * gst) / 100 / 2) * 100) / 100;
  const total = Math.round(taxable + half * 2);
  doc.moveDown(0.6);
  const x = doc.page.margins.left + 300;
  const line = (label: string, value: string) => {
    const y = doc.y;
    doc.text(label, x, y, { width: 130 }).text(value, x + 130, y, { width: 85, align: "right" });
  };
  line("Taxable Value", fmtMoney(taxable));
  line(`CGST @ ${gst / 2}%`, fmtMoney(half));
  line(`SGST @ ${gst / 2}%`, fmtMoney(half));
  line("Round Off", fmtMoney(Math.round((total - taxable - half * 2) * 100) / 100));
  doc.font("B");
  line("Grand Total", fmtMoney(total));
  doc.font("R").moveDown(1.5).text("Amount in words: (sample)", doc.page.margins.left);
  return toBuffer(doc);
}
