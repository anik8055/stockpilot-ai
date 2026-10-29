import "server-only";
import type { Tx } from "@/lib/db";
import { createDoc, fmtMoney, fmtQty, footer, formatDate, heading, muted, table, toBuffer } from "./pdf";
import { getPurchaseOrder } from "./purchasing";

export async function purchaseOrderPdf(db: Tx, businessId: string, poId: string): Promise<{ buffer: Buffer; filename: string }> {
  const { po, lines } = await getPurchaseOrder(db, businessId, poId);
  const biz = await db.one<{ name: string; legal_name: string | null; gstin: string | null; address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; email: string | null; is_demo: boolean }>(
    "SELECT name, legal_name, gstin, address_line1, address_line2, city, state, pincode, phone, email, is_demo FROM businesses WHERE id = $1",
    [businessId],
  );
  const doc = createDoc(`Purchase order ${po.po_number}`);
  const left = doc.page.margins.left;
  const width = doc.page.width - left * 2;

  heading(doc, biz.legal_name || biz.name, 15);
  const addr = [biz.address_line1, biz.address_line2, [biz.city, biz.state, biz.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n");
  if (addr) muted(doc, addr);
  muted(doc, [biz.gstin ? `GSTIN ${biz.gstin}` : null, biz.phone, biz.email].filter(Boolean).join("   "));
  if (biz.is_demo) doc.moveDown(0.3).fillColor("#9a5b05").text("Synthetic demo data — not a real business or order.").fillColor("#10233f");

  doc.moveDown(1);
  const top = doc.y;
  doc.font("B").fontSize(13).text(po.status === "draft" ? "Purchase order (draft)" : "Purchase order", left, top);
  doc.font("R").fontSize(9);
  doc.text(`PO number: ${po.po_number}`).text(`Order date: ${formatDate(po.order_date)}`);
  if (po.expected_date) doc.text(`Expected delivery: ${formatDate(po.expected_date)}`);
  const afterLeft = doc.y;

  doc.font("B").text("Supplier", left + width / 2, top);
  doc.font("R").text(po.supplier_name, left + width / 2);
  const supAddr = [po.supplier_address, [po.supplier_city, po.supplier_state].filter(Boolean).join(", ")].filter(Boolean).join("\n");
  if (supAddr) doc.text(supAddr, left + width / 2);
  if (po.supplier_gstin) doc.text(`GSTIN ${po.supplier_gstin}`, left + width / 2);
  if (po.supplier_phone) doc.text(po.supplier_phone, left + width / 2);
  doc.x = left;
  doc.y = Math.max(afterLeft, doc.y) + 14;

  table(
    doc,
    [
      { key: "n", label: "#", width: 22 },
      { key: "item", label: "Item", width: 178 },
      { key: "code", label: "Supplier code", width: 70 },
      { key: "qty", label: "Qty", width: 50, align: "right" },
      { key: "unit", label: "Unit", width: 36 },
      { key: "rate", label: "Rate (INR)", width: 62, align: "right" },
      { key: "tax", label: "GST %", width: 40, align: "right" },
      { key: "amount", label: "Amount (INR)", width: 57, align: "right" },
    ],
    lines.map((l) => ({
      n: String(l.line_no),
      item: `${l.name}\n${l.sku}`,
      code: l.supplier_sku ?? "",
      qty: fmtQty(l.quantity),
      unit: l.unit,
      rate: fmtMoney(l.unit_price),
      tax: Number(l.tax_rate) ? fmtQty(l.tax_rate) : "—",
      amount: fmtMoney(l.line_total),
    })),
    { zebra: true },
  );

  doc.moveDown(0.6);
  const tx = left + width - 200;
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? "B" : "R").text(label, tx, y, { width: 110 }).text(value, tx + 110, y, { width: 90, align: "right" });
  };
  row("Subtotal", fmtMoney(po.subtotal));
  if (Number(po.tax_total)) row("GST", fmtMoney(po.tax_total));
  row("Total (INR)", fmtMoney(po.total), true);
  doc.x = left;
  doc.font("R");
  if (po.notes) {
    doc.moveDown(1).font("B").text("Notes", left).font("R").text(po.notes, { width });
  }
  doc.moveDown(1.2);
  muted(doc, "Please confirm quantities, rates and the delivery date. Quote the PO number on your invoice.", { width });
  footer(doc, `${po.po_number} · prepared with StockPilot AI`);
  return { buffer: await toBuffer(doc), filename: `${po.po_number}.pdf` };
}
