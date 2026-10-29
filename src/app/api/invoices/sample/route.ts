import { formatDate } from "@/lib/domain/dates";
import { fileResponse, withRoute } from "@/lib/route";
import { sampleInvoicePdf } from "@/lib/services/sample-invoice";
import { tx } from "@/lib/tenant";

/**
 * A synthetic invoice built from this workspace's own supplier and products, so the extraction and matching
 * workflow can be tried end to end. It is labelled as a sample inside the PDF.
 */
export async function GET() {
  return withRoute("view", "invoices.sample", async (t) => {
    const data = await tx(t, async (db) => {
      const s = await db.maybeOne<{ id: string; name: string; gstin: string | null }>(
        `SELECT s.id, s.name, s.gstin FROM suppliers s WHERE s.business_id = $1 AND s.active
          ORDER BY (SELECT count(*) FROM supplier_products sp WHERE sp.supplier_id = s.id) DESC LIMIT 1`,
        [t.businessId],
      );
      const lines = s
        ? await db.query<{ name: string; code: string | null; base_unit: string; price: string | null }>(
            `SELECT p.name, sp.supplier_sku AS code, p.base_unit, coalesce(sp.purchase_price, p.purchase_cost) AS price
               FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE sp.supplier_id = $1 AND p.active ORDER BY p.name LIMIT 4`,
            [s.id],
          )
        : [];
      return { s, lines };
    });
    const lines = data.lines.length
      ? data.lines.map((l, i) => ({ description: l.name, code: l.code ?? "", hsn: "8536", qty: [12, 5, 20, 8][i] ?? 6, unit: l.base_unit, rate: Math.round(Number(l.price ?? 100) * 100) / 100 }))
      : [{ description: "Sample item", code: "SMP-1", hsn: "8536", qty: 10, unit: "pcs", rate: 100 }];
    const pdf = await sampleInvoicePdf({
      supplierName: data.s?.name ?? "Sample Supplier",
      supplierGstin: data.s?.gstin ?? "27AAACS0000A1Z5",
      buyerName: t.business.name,
      invoiceNumber: `SMP/${Date.now().toString().slice(-6)}`,
      invoiceDate: formatDate(new Date()).replace(/ /g, "-"),
      lines,
    });
    return fileResponse(pdf, "sample-supplier-invoice.pdf", "application/pdf");
  });
}
