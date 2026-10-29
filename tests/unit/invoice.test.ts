import { describe, expect, it } from "vitest";
import { checkInvoice, matchLine, parseInvoiceText, parseItemLine, type MatchCandidate } from "@/lib/domain/invoice";
import { extractInvoiceText, sniffInvoiceFile } from "@/lib/services/invoice-text";
import { sampleInvoicePdf } from "@/lib/services/sample-invoice";

const LINES = [
  { description: "MCB 16A Single Pole C-Curve", code: "KV-MCB16", hsn: "8536", qty: 24, unit: "Nos", rate: 186 },
  { description: "FR Copper Wire 2.5 sqmm Red", code: "KV-W25R", hsn: "8544", qty: 2, unit: "Coil", rate: 3375, discount: 150 },
  { description: "Modular Switch 6A 1-Way", code: "KV-SW6", hsn: "8536", qty: 100, unit: "Nos", rate: 28 },
];

describe("invoice line parsing", () => {
  it("reads qty × rate = amount rows and rejects rows that do not reconcile", () => {
    expect(parseItemLine("1 MCB 16A Single Pole KV-MCB16 8536 24 Nos 186.00 4,464.00")).toMatchObject({ quantity: 24, unit: "pcs", unit_price: 186, line_total: 4464, hsn: "8536", supplier_code: "KV-MCB16" });
    expect(parseItemLine("2 Wire 2.5 sqmm 2 Coil 3,375.00 150.00 6,600.00")).toMatchObject({ quantity: 2, unit_price: 3375, discount_amount: 150, line_total: 6600 });
    expect(parseItemLine("3 Something 10 5.00 999.00")).toBeNull(); // 10 × 5 ≠ 999
    expect(parseItemLine("Phone 98765 43210")).toBeNull();
  });

  it("joins wrapped descriptions from the lines above", () => {
    const r = parseItemLine("KV-SW6 100 Nos 28.00 2,800.00", ["3 Modular Switch 6A 1-Way"]);
    expect(r?.description).toBe("Modular Switch 6A 1-Way");
    expect(r?.supplier_code).toBe("KV-SW6");
  });
});

describe("end-to-end text pipeline on a generated PDF", () => {
  it("extracts header, lines and totals that reconcile", async () => {
    const pdf = await sampleInvoicePdf({ supplierName: "Kaveri Sample Wires", supplierGstin: "27AAACK1234F1Z5", buyerName: "Test Buyer", invoiceNumber: "KWC/26/0412", invoiceDate: "24/10/2026", lines: LINES });
    expect(sniffInvoiceFile(pdf)).toBe("pdf");
    const t = await extractInvoiceText(pdf, "pdf");
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const inv = parseInvoiceText(t.text);
    expect(inv.invoice_number).toBe("KWC/26/0412");
    expect(inv.invoice_date).toBe("2026-10-24");
    expect(inv.supplier_gstin).toBe("27AAACK1234F1Z5");
    expect(inv.lines).toHaveLength(3);
    expect(inv.lines.map((l) => l.line_total)).toEqual([4464, 6600, 2800]);
    expect(inv.subtotal).toBe(13864);
    expect(inv.tax_total).toBeCloseTo(2495.52, 2);
    expect(inv.total).toBe(16360);
    const c = checkInvoice(inv);
    expect(c.consistent).toBe(true);
    expect(c.checks.at(-1)?.level).toBe("ok");
  });
});

describe("arithmetic checks", () => {
  const base = { subtotal: 300, tax_total: 54, total: 354, lines: [{ description: "A", quantity: 2, unit_price: 100, line_total: 200 }, { description: "B", quantity: 1, unit_price: 100, line_total: 100 }] };
  it("passes a consistent invoice", () => {
    expect(checkInvoice(base).consistent).toBe(true);
  });
  it("flags a line whose amount is wrong", () => {
    const r = checkInvoice({ ...base, lines: [{ ...base.lines[0], line_total: 250 }, base.lines[1]] });
    expect(r.consistent).toBe(false);
    expect(r.checks[0].message).toMatch(/Line 1/);
  });
  it("flags totals that do not add up, allowing ₹1 round-off", () => {
    expect(checkInvoice({ ...base, total: 354.6 }).consistent).toBe(true);
    expect(checkInvoice({ ...base, total: 360 }).consistent).toBe(false);
    expect(checkInvoice({ ...base, subtotal: 280 }).checks.some((c) => c.field === "subtotal")).toBe(true);
  });
  it("is not consistent with no lines", () => {
    expect(checkInvoice({ ...base, lines: [] }).consistent).toBe(false);
  });
});

describe("conservative SKU matching", () => {
  const products: MatchCandidate[] = [
    { id: "p1", sku: "MCB-16A-SP", name: "MCB 16A Single Pole C-Curve", mpn: null, barcode: null, codes: [{ value: "KV-MCB16", supplierId: "s1" }] },
    { id: "p2", sku: "MCB-16A-DP", name: "MCB 16A Double Pole C-Curve", mpn: null, barcode: null, codes: [] },
    { id: "p3", sku: "SW-6A", name: "Modular Switch 6A 1-Way", mpn: "AN-6601", barcode: null, codes: [] },
  ];
  it("auto-matches on this supplier's code, SKU, part number or exact name", () => {
    expect(matchLine({ description: "MCB 16A SP", supplier_code: "KV-MCB16" }, products, "s1")).toMatchObject({ productId: "p1", method: "supplier_code" });
    expect(matchLine({ description: "MCB-16A-DP breaker", supplier_code: null }, products, null)).toMatchObject({ productId: "p2", method: "sku" });
    expect(matchLine({ description: "Switch AN-6601", supplier_code: null }, products, null)).toMatchObject({ productId: "p3", method: "mpn" });
    expect(matchLine({ description: "modular switch 1-way 6A", supplier_code: null }, products, null)).toMatchObject({ productId: "p3", method: "name" });
  });
  it("does not use another supplier's code", () => {
    expect(matchLine({ description: "x", supplier_code: "KV-MCB16" }, products, "s2").productId).toBeNull();
  });
  it("only suggests fuzzy matches", () => {
    const r = matchLine({ description: "MCB 16A C-Curve breaker", supplier_code: null }, products, null);
    expect(r.productId).toBeNull();
    expect(r.method).toBe("suggested");
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});

describe("code detection", () => {
  it("does not mistake sizes for supplier codes", () => {
    const r = parseItemLine("1 Claw Hammer 500g 8205 12 pcs 210.00 2,520.00");
    expect(r?.description).toBe("Claw Hammer 500g");
    expect(r?.supplier_code).toBeNull();
    expect(parseItemLine("2 Screwdriver Set 6pc HW-SCR-SET 8 pcs 180.00 1,440.00")).toMatchObject({ description: "Screwdriver Set 6pc", supplier_code: "HW-SCR-SET" });
  });
});

describe("file sniffing", () => {
  it("accepts only PDF and common images", () => {
    expect(sniffInvoiceFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniffInvoiceFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffInvoiceFile(Buffer.from("MZ\x90\x00 executable"))).toBeNull();
    expect(sniffInvoiceFile(Buffer.from("<html><script>"))).toBeNull();
  });
  it("reports images as unsupported when OCR is not configured", async () => {
    const r = await extractInvoiceText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]), "png");
    expect(r).toMatchObject({ ok: false, reason: "image_no_ocr" });
  });
});
