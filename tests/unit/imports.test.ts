import { describe, expect, it } from "vitest";
import { applySavedMapping, detectHeaderRow, mappingToHeaderNames, suggestMapping } from "@/lib/domain/imports/mapping";
import { validateRows, type ProductLookup, type ProductRef } from "@/lib/domain/imports/validate";
import { csvSafe, detectDateOrder, parseDate, parseNumber, toCsv } from "@/lib/domain/imports/values";
import { buildXlsx, detectFormat, parseSpreadsheet } from "@/lib/services/spreadsheet";

const products: ProductRef[] = [
  { id: "p1", sku: "MCB-16A", name: "MCB 16A Single Pole", baseUnit: "pcs", conversions: [{ unitCode: "box", factorToBase: 12 }] },
  { id: "p2", sku: "WIRE-2.5", name: "Copper Wire 2.5 sqmm", baseUnit: "m", conversions: [{ unitCode: "coil", factorToBase: 90 }] },
  { id: "p3", sku: "BP-101", name: "Brake Pad", baseUnit: "set", conversions: [] },
  { id: "p4", sku: "BP-102", name: "Brake Pad", baseUnit: "set", conversions: [] },
];
const lookup: ProductLookup = {
  byCode: (c) => products.find((p) => p.sku.toLowerCase() === c.toLowerCase()) ?? (c.toLowerCase() === "alias-mcb" ? products[0] : null),
  byName: (n) => {
    const m = products.filter((p) => p.name.toLowerCase() === n.toLowerCase());
    return m.length > 1 ? "ambiguous" : m[0] ?? null;
  },
};
const opts = { today: "2026-10-29" };

describe("value parsing", () => {
  it("parses Indian number formats", () => {
    expect(parseNumber("1,23,456.50")).toMatchObject({ ok: true, value: 123456.5 });
    expect(parseNumber("₹ 2,499")).toMatchObject({ ok: true, value: 2499 });
    expect(parseNumber("Rs. 120.75")).toMatchObject({ ok: true, value: 120.75 });
    expect(parseNumber("(150)")).toMatchObject({ ok: true, value: -150 });
    expect(parseNumber("12 Nos")).toMatchObject({ ok: true, value: 12, unitHint: "pcs" });
    expect(parseNumber("-")).toMatchObject({ ok: true, value: null });
    expect(parseNumber("abc").ok).toBe(false);
    expect(parseNumber("12a34").ok).toBe(false);
  });

  it("parses dates day-first by default", () => {
    expect(parseDate("05/09/2026")).toEqual({ ok: true, value: "2026-09-05" });
    expect(parseDate("05/09/2026", "mdy")).toEqual({ ok: true, value: "2026-05-09" });
    expect(parseDate("5-Sep-26")).toEqual({ ok: true, value: "2026-09-05" });
    expect(parseDate("Sept 5, 2026")).toEqual({ ok: true, value: "2026-09-05" });
    expect(parseDate("2026-09-05")).toEqual({ ok: true, value: "2026-09-05" });
    expect(parseDate("46270")).toEqual({ ok: true, value: "2026-09-05" }); // Excel serial
    expect(parseDate("31/02/2026").ok).toBe(false);
    expect(parseDate("yesterday").ok).toBe(false);
  });

  it("detects day/month order from samples and flags ambiguity", () => {
    expect(detectDateOrder(["13/01/2026", "02/02/2026"])).toEqual({ order: "dmy", ambiguous: false });
    expect(detectDateOrder(["01/13/2026"])).toEqual({ order: "mdy", ambiguous: false });
    expect(detectDateOrder(["01/02/2026", "03/04/2026"])).toEqual({ order: "dmy", ambiguous: true });
  });

  it("guards CSV exports against formula injection", () => {
    expect(csvSafe("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvSafe("-5")).toBe("-5");
    expect(csvSafe("+91 98")).toBe("'+91 98");
    expect(toCsv(["a"], [["@x"]])).toContain("'@x");
  });
});

describe("header detection and mapping", () => {
  it("finds the header row below company title rows", () => {
    const rows = [["Sharma Electricals"], ["Stock Summary 01-Apr-26 to 30-Sep-26"], [], ["Item Code", "Stock Item", "Closing Stock", "Rate"], ["MCB-16A", "MCB", "10", "120"]];
    expect(detectHeaderRow(rows, "stock_snapshot")).toBe(3);
  });

  it("maps common header variations", () => {
    const s = suggestMapping(["Item Code", "Stock Item", "Closing Stock", "UOM", "Purchase Rate"], "stock_snapshot");
    expect(s.mapping.sku).toBe(0);
    expect(s.mapping.name).toBe(1);
    expect(s.mapping.quantity).toBe(2);
    expect(s.mapping.unit).toBe(3);
    expect(s.mapping.unit_cost).toBe(4);
    expect(s.missingRequired).toEqual([]);
  });

  it("maps product master variations including vendor", () => {
    const s = suggestMapping(["Part Number", "Product", "Brand", "Cost Price", "MRP", "Vendor", "Reorder Level"], "products");
    expect(s.mapping).toMatchObject({ sku: 0, name: 1, brand: 2, purchase_cost: 3, selling_price: 4, supplier_name: 5, min_stock: 6 });
  });

  it("flags ambiguous columns instead of guessing silently", () => {
    const s = suggestMapping(["SKU", "Item Name", "Qty", "Quantity"], "sales");
    expect(s.ambiguities.some((a) => a.field === "quantity")).toBe(true);
    expect(s.needsConfirmation).toBe(true);
    expect(s.missingRequired).toContain("Sale date");
  });

  it("warns when a sales report is uploaded as stock balances", () => {
    const s = suggestMapping(["Date", "Invoice No", "Item Code", "Qty"], "stock_snapshot");
    expect(s.kindHints[0]).toMatch(/sales or purchase report/);
  });

  it("round-trips saved mappings by header name", () => {
    const headers = ["Code", "Desc", "Qty"];
    const saved = mappingToHeaderNames({ sku: 0, quantity: 2, name: null }, headers);
    expect(applySavedMapping(saved, ["Qty", "Code", "Other"])).toEqual({ sku: 1, quantity: 0, name: null });
  });
});

describe("row validation", () => {
  it("validates stock rows with unit conversion and reports errors per row", () => {
    const rows = [
      ["MCB-16A", "", "2", "box"],
      ["WIRE-2.5", "", "180", "m"],
      ["WIRE-2.5", "", "1", "coil"], // duplicate product
      ["UNKNOWN", "", "5", ""],
      ["BP-101", "", "3", "kg"], // no conversion
      ["", "Brake Pad", "1", ""], // ambiguous name
      ["alias-mcb", "", "abc", ""],
      ["Grand Total", "", "200", ""],
      [],
    ];
    const { rows: out, summary } = validateRows("stock_snapshot", rows, 2, { sku: 0, name: 1, quantity: 2, unit: 3, unit_cost: null }, lookup, opts);
    expect(out[0]).toMatchObject({ rowNumber: 2, status: "valid", record: { _productId: "p1", _baseQty: 24 } });
    expect(out[1].status).toBe("valid");
    expect(out[2].issues[0].code).toBe("duplicate_in_file");
    expect(out[3].issues[0].code).toBe("unknown_product");
    expect(out[4].issues.map((i) => i.code)).toContain("unit_mismatch");
    expect(out[5].issues[0].code).toBe("ambiguous_product");
    expect(out[6].issues[0].code).toBe("invalid_number");
    expect(out[7].status).toBe("skipped");
    expect(out).toHaveLength(8); // blank row ignored
    expect(summary).toMatchObject({ valid: 2, errors: 5, skipped: 1, distinctProducts: 2, totalQuantity: 204 });
  });

  it("validates sales rows: dates, zero/negative quantities, amount checks, repeats", () => {
    const rows = [
      ["01/09/2026", "MCB-16A", "5", "100", "500", "INV-1"],
      ["01/09/2026", "MCB-16A", "5", "100", "500", "INV-1"],
      ["02/09/2026", "MCB-16A", "0", "100", "0", "INV-2"],
      ["03/09/2026", "MCB-16A", "-2", "100", "-200", "CN-1"],
      ["04/09/2026", "MCB-16A", "3", "100", "354", "INV-3"],
      ["31/12/2026", "MCB-16A", "1", "", "", "INV-4"],
      ["", "MCB-16A", "1", "", "", "INV-5"],
    ];
    const mapping = { date: 0, sku: 1, quantity: 2, unit_price: 3, line_total: 4, invoice_ref: 5, name: null, unit: null, customer: null };
    const { rows: out, summary } = validateRows("sales", rows, 2, mapping, lookup, opts);
    expect(out[0].status).toBe("valid");
    expect(out[1].issues[0].code).toBe("repeated_row");
    expect(out[1].record._occurrence).toBe(2);
    expect(out[2]).toMatchObject({ status: "skipped" });
    expect(out[3].issues.at(-1)?.code).toBe("negative_qty");
    expect(out[4].issues[0].code).toBe("amount_mismatch");
    expect(out[4].status).toBe("valid");
    expect(out[5].issues[0].code).toBe("future_date");
    expect(out[6].issues[0].code).toBe("required");
    expect(summary.dateFrom).toBe("2026-09-01");
    expect(summary.dateTo).toBe("2026-09-04");
  });

  it("validates product master rows", () => {
    const rows = [
      ["MCB-16A", "MCB 16A", "10", "5", "120"],
      ["NEW-1", "New item", "", "", ""],
      ["NEW-1", "Dup", "", "", ""],
      ["NEW-2", "", "5", "10", "-4"],
    ];
    const { rows: out, summary } = validateRows("products", rows, 2, { sku: 0, name: 1, min_stock: 2, max_stock: 3, purchase_cost: 4 }, lookup, opts);
    expect(out[0].issues.map((i) => i.code)).toContain("max_below_min");
    expect(out[1].issues[0].code).toBe("default_unit");
    expect(out[1].status).toBe("valid");
    expect(out[2].issues[0].code).toBe("duplicate_in_file");
    expect(out[3].issues.map((i) => i.code)).toEqual(expect.arrayContaining(["negative", "required"]));
    expect(summary.creates).toBe(1);
  });
});

describe("file parsing", () => {
  it("parses CSV with BOM and keeps row numbers", async () => {
    const buf = Buffer.from("﻿Item Code,Qty\r\nA,1\r\n\r\nB,\"1,200\"\r\n", "utf8");
    const wb = await parseSpreadsheet(buf);
    expect(wb.format).toBe("csv");
    expect(wb.sheets[0].rows).toEqual([["Item Code", "Qty"], ["A", "1"], [], ["B", "1,200"]]);
  });

  it("parses xlsx including dates and formulas (cached values only)", async () => {
    const buf = await buildXlsx([{ name: "Stock", headers: ["SKU", "Qty", "Date"], rows: [["A1", 5, "2026-09-01"], ["=1+1", 3, null]] }]);
    expect(detectFormat(buf)).toBe("xlsx");
    const wb = await parseSpreadsheet(buf);
    expect(wb.sheets[0].rows[0]).toEqual(["SKU", "Qty", "Date"]);
    expect(wb.sheets[0].rows[1]).toEqual(["A1", "5", "2026-09-01"]);
    expect(wb.sheets[0].rows[2][0]).toBe("'=1+1"); // written as text, never a formula
  });

  it("rejects binary and legacy files", async () => {
    await expect(parseSpreadsheet(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).rejects.toThrow(/xls/);
    await expect(parseSpreadsheet(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 1]))).rejects.toThrow(/does not look like/);
  });
});
