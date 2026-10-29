import PDFDocument from "pdfkit";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setProviderForTests, type AIProvider } from "@/lib/ai/provider";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import { createProduct } from "@/lib/services/catalog";
import { createReceiptFromInvoice, getInvoice, saveReview, uploadInvoice } from "@/lib/services/invoices";
import { confirmReceipt, createSupplier } from "@/lib/services/purchasing";
import { sampleInvoicePdf } from "@/lib/services/sample-invoice";
import { createBusiness } from "@/lib/services/workspaces";
import { resetTestDatabase } from "./db";

let ctx: { userId: string; businessId: string };
let supplierId: string;
const ids: Record<string, string> = {};
const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ctx, fn);
const stock = async (sku: string) => Number((await run((tx) => tx.one<{ on_hand: string }>("SELECT on_hand FROM products WHERE sku = $1", [sku]))).on_hand);

function textlessPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.rect(50, 50, 300, 200).fill("#888");
    doc.end();
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  const u = await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ('inv@test.local', 'Inv', 'x') RETURNING id"));
  const b = await createBusiness(u.id, { name: "Invoice Test Electricals", industry: "electrical" });
  ctx = { userId: u.id, businessId: b.id };
  supplierId = (await run((tx) => createSupplier(tx, ctx, { name: "Kaveri Sample Wires", gstin: "27AAACK1234F1Z5" })))!;
  ids.mcb = await run((tx) => createProduct(tx, ctx, { sku: "MCB-16A-SP", name: "MCB 16A Single Pole C-Curve", base_unit: "pcs", opening_stock: "5" }));
  ids.wire = await run((tx) => createProduct(tx, ctx, { sku: "WIRE-25-RED", name: "FR Copper Wire 2.5 sqmm Red", base_unit: "m" }));
  ids.sw = await run((tx) => createProduct(tx, ctx, { sku: "SW-6A", name: "Modular Switch 6A 1-Way", base_unit: "pcs" }));
  await run(async (tx) => {
    await tx.query("INSERT INTO product_aliases (business_id, product_id, alias_type, value, supplier_id) VALUES ($1,$2,'supplier_code','KV-MCB16',$3)", [ctx.businessId, ids.mcb, supplierId]);
    await tx.query("INSERT INTO product_units (business_id, product_id, unit_code, factor_to_base) VALUES ($1,$2,'coil',90)", [ctx.businessId, ids.wire]);
  });
});

afterEach(() => setProviderForTests(undefined));
afterAll(closePools);

let samplePdf: Buffer | null = null;
const sample = async () =>
  (samplePdf ??= await sampleInvoicePdf({
    supplierName: "Kaveri Sample Wires",
    supplierGstin: "27AAACK1234F1Z5",
    buyerName: "Invoice Test Electricals",
    invoiceNumber: "KWC/26/0412",
    invoiceDate: "24/10/2026",
    lines: [
      { description: "MCB 16A Single Pole C-Curve", code: "KV-MCB16", hsn: "8536", qty: 24, unit: "Nos", rate: 186 },
      { description: "FR Copper Wire 2.5 sqmm Red", code: "KV-W25R", hsn: "8544", qty: 2, unit: "Coil", rate: 3375, discount: 150 },
      { description: "Modular Switch 6A 1-Way", code: "KV-SW6", hsn: "8536", qty: 100, unit: "Nos", rate: 28 },
    ],
  }));

describe("invoice extraction and review", () => {
  let invoiceId: string;

  it("extracts a text PDF, detects the supplier by GSTIN and matches lines conservatively", async () => {
    setProviderForTests(null); // AI disabled: the rule-based path must work on its own
    const r = await run(async (tx) => uploadInvoice(tx, ctx, "kaveri-0412.pdf", await sample()));
    invoiceId = r.id;
    const { doc, lines } = await run((tx) => getInvoice(tx, ctx.businessId, r.id));
    expect(doc.status).toBe("needs_review");
    expect(doc.provider).toBe("pdf_text+rules");
    expect(doc.supplier_id).toBe(supplierId);
    expect(doc.invoice_number).toBe("KWC/26/0412");
    expect(Number(doc.total)).toBe(16360);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ matched_product_id: ids.mcb, match_method: "supplier_code" });
    expect(lines[1]).toMatchObject({ matched_product_id: ids.wire, match_method: "name" });
    expect(lines[2]).toMatchObject({ matched_product_id: ids.sw, match_method: "name" });
    expect(doc.warnings).toEqual([]);
  });

  it("detects a duplicate upload of the same file", async () => {
    const r = await run(async (tx) => uploadInvoice(tx, ctx, "again.pdf", await sample()));
    expect(r.duplicateOf).toBe(invoiceId);
  });

  it("creates a draft receipt that does not change stock until confirmed", async () => {
    const { doc, lines } = await run((tx) => getInvoice(tx, ctx.businessId, invoiceId));
    const check = await run((tx) =>
      saveReview(tx, ctx, invoiceId, {
        supplier_id: doc.supplier_id,
        invoice_number: doc.invoice_number,
        invoice_date: doc.invoice_date,
        subtotal: Number(doc.subtotal),
        tax_total: Number(doc.tax_total),
        total: Number(doc.total),
        lines: lines.map((l) => ({ id: l.id, include: true, description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price), discount_amount: l.discount_amount ? Number(l.discount_amount) : null, line_total: Number(l.line_total), product_id: l.matched_product_id })),
      }),
    );
    expect(check.consistent).toBe(true);
    const receipt = await run((tx) => createReceiptFromInvoice(tx, ctx, invoiceId, { idempotencyKey: "inv-receipt-0001" }));
    expect(await stock("MCB-16A-SP")).toBe(5);
    await run((tx) => confirmReceipt(tx, ctx, receipt.id));
    expect(await stock("MCB-16A-SP")).toBe(29);
    expect(await stock("WIRE-25-RED")).toBe(180); // 2 coils × 90 m
    expect((await run((tx) => getInvoice(tx, ctx.businessId, invoiceId))).doc.status).toBe("confirmed");
    // confirming again cannot add stock twice
    await run((tx) => confirmReceipt(tx, ctx, receipt.id));
    expect(await stock("MCB-16A-SP")).toBe(29);
  });

  it("reports scanned PDFs as unsupported when OCR is not configured", async () => {
    const r = await run(async (tx) => uploadInvoice(tx, ctx, "scan.pdf", await textlessPdf()));
    const { doc } = await run((tx) => getInvoice(tx, ctx.businessId, r.id));
    expect(doc.status).toBe("unsupported");
    expect(doc.error).toMatch(/scanned image/);
  });

  it("rejects non-invoice files", async () => {
    await expect(run((tx) => uploadInvoice(tx, ctx, "evil.html", Buffer.from("<html><script>alert(1)</script></html>")))).rejects.toThrow(/Upload a PDF/);
  });
});

describe("AI structuring fallback", () => {
  const oddLayout = async () => {
    // A layout the rule-based parser cannot reconcile: amounts on separate lines from quantities
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
    doc.text("Odd Layout Traders\nGSTIN 27AAACK1234F1Z5\nInvoice No: ODD-77  Date: 01/10/2026\nItem: MCB 16A Single Pole C-Curve\nQuantity: ten\nRate per piece 186\nLine value 1860\nGrand Total 2195");
    doc.end();
    return done;
  };

  it("uses validated model output and logs usage", async () => {
    const fake: AIProvider = {
      name: "fake",
      model: "fake-1",
      health: async () => ({ ok: true, message: "" }),
      chatJSON: async (_m, schema) => {
        const data = schema.parse({ supplier_name: "Odd Layout Traders", supplier_gstin: "27AAACK1234F1Z5", invoice_number: "ODD-77", invoice_date: "2026-10-01", subtotal: 1860, tax_total: 334.8, total: 2195, lines: [{ description: "MCB 16A Single Pole C-Curve", supplier_code: null, hsn: null, quantity: 10, unit: "pcs", unit_price: 186, discount_amount: null, tax_rate: null, line_total: 1860 }] });
        return { ok: true, data, usage: { promptTokens: 100, completionTokens: 50 }, latencyMs: 5, model: "fake-1" };
      },
    };
    setProviderForTests(fake);
    const r = await run(async (tx) => uploadInvoice(tx, ctx, "odd.pdf", await oddLayout()));
    const { doc, lines } = await run((tx) => getInvoice(tx, ctx.businessId, r.id));
    expect(doc.provider).toBe("pdf_text+llm");
    expect(lines).toHaveLength(1);
    expect(lines[0].matched_product_id).toBe(ids.mcb);
    expect(doc.warnings[0]).toMatch(/structured by the AI model/);
    const usage = await run((tx) => tx.one<{ c: number }>("SELECT count(*)::int AS c FROM ai_usage WHERE feature = 'invoice_extraction' AND status = 'ok'"));
    expect(usage.c).toBe(1);
  });

  it("falls back to the rule-based reading when the model output is invalid", async () => {
    setProviderForTests({
      name: "fake",
      model: "fake-1",
      health: async () => ({ ok: true, message: "" }),
      chatJSON: async () => ({ ok: false, reason: "invalid_output", message: "The AI response did not match the expected format.", latencyMs: 5, model: "fake-1" }),
    });
    const pdf = await oddLayout();
    const tweaked = Buffer.concat([pdf, Buffer.from("\n% different bytes\n")]); // avoid duplicate-hash detection
    const r = await run((tx) => uploadInvoice(tx, ctx, "odd2.pdf", tweaked));
    const { doc } = await run((tx) => getInvoice(tx, ctx.businessId, r.id));
    expect(doc.provider).toBe("pdf_text+rules");
    expect(doc.warnings.join(" ")).toMatch(/AI structuring was unavailable/);
    const bad = await run((tx) => tx.one<{ c: number }>("SELECT count(*)::int AS c FROM ai_usage WHERE status = 'invalid_output'"));
    expect(bad.c).toBe(1);
  });
});
