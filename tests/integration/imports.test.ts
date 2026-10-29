import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import type { ImportKind } from "@/lib/domain/imports/fields";
import { commitImport, createImportJob, errorReportCsv, getImportJob, listIssues, validateImport, type ImportOptions } from "@/lib/services/imports";
import { createBusiness } from "@/lib/services/workspaces";
import { resetTestDatabase } from "./db";

let ctx: { userId: string; businessId: string; timezone: string };

const csv = (rows: (string | number)[][]) => Buffer.from(rows.map((r) => r.map((c) => (String(c).includes(",") ? `"${c}"` : c)).join(",")).join("\n"));

async function importFile(kind: ImportKind, name: string, buf: Buffer, opts: ImportOptions = {}) {
  const id = await withTenant(ctx, (tx) => createImportJob(tx, ctx, kind, name, buf));
  const job = await withTenant(ctx, (tx) => getImportJob(tx, ctx.businessId, id));
  const summary = await withTenant(ctx, (tx) => validateImport(tx, ctx, id, job.mapping!, { ...job.options, ...opts }));
  return { id, job, summary };
}

const commit = (id: string) => withTenant(ctx, (tx) => commitImport(tx, ctx, id));
const stock = async (sku: string) =>
  Number((await withTenant(ctx, (tx) => tx.one<{ on_hand: string }>("SELECT on_hand FROM products WHERE sku = $1", [sku]))).on_hand);

beforeAll(async () => {
  await resetTestDatabase();
  const u = await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ('imp@test.local', 'Imp', 'x') RETURNING id"));
  const b = await createBusiness(u.id, { name: "Import Test Traders", industry: "electrical" });
  ctx = { userId: u.id, businessId: b.id, timezone: "Asia/Kolkata" };
});

afterAll(closePools);

describe("product master import", () => {
  it("maps header variations, creates products and suppliers", async () => {
    const file = csv([
      ["Sharma Electricals — Stock Item List"],
      [],
      ["Part Number", "Stock Item", "UOM", "Cost Price", "MRP", "Vendor", "Supplier Code", "Reorder Level"],
      ["MCB-16", "MCB 16A SP", "Nos", "186", "242", "Kaveri Traders", "K-16", "24"],
      ["WIRE-25", "Copper Wire 2.5 sqmm", "MTR", "37.50", "46", "Kaveri Traders", "", "180"],
      ["BAD-1", "", "pcs", "abc", "", "", "", ""],
    ]);
    const { id, job, summary } = await importFile("products", "items.csv", file);
    expect(job.header_row).toBe(2);
    expect(job.mapping).toMatchObject({ sku: 0, name: 1, base_unit: 2, purchase_cost: 3, selling_price: 4, supplier_name: 5, supplier_sku: 6, min_stock: 7 });
    expect(summary).toMatchObject({ valid: 2, errors: 1, creates: 2 });
    const result = await commit(id);
    expect(result).toMatchObject({ created: 2, updated: 0, suppliersLinked: 1 });
    const p = await withTenant(ctx, (tx) => tx.one<{ base_unit: string; purchase_cost: string; supplier: string }>("SELECT p.base_unit, p.purchase_cost, s.name AS supplier FROM products p JOIN suppliers s ON s.id = p.preferred_supplier_id WHERE sku = 'WIRE-25'"));
    expect(p).toMatchObject({ base_unit: "m", purchase_cost: "37.5000", supplier: "Kaveri Traders" });
    // supplier code becomes an alias usable by later imports
    const alias = await withTenant(ctx, (tx) => tx.query("SELECT 1 FROM product_aliases WHERE value = 'K-16'"));
    expect(alias).toHaveLength(1);
  });

  it("re-importing updates instead of duplicating, and blank cells keep existing values", async () => {
    const file = csv([["SKU", "Item Name", "Cost Price"], ["MCB-16", "MCB 16A Single Pole", ""]]);
    const { id } = await importFile("products", "items2.csv", file);
    expect(await commit(id)).toMatchObject({ created: 0, updated: 1 });
    const p = await withTenant(ctx, (tx) => tx.one<{ name: string; purchase_cost: string }>("SELECT name, purchase_cost FROM products WHERE sku = 'MCB-16'"));
    expect(p).toEqual({ name: "MCB 16A Single Pole", purchase_cost: "186.0000" });
    const n = await withTenant(ctx, (tx) => tx.one<{ c: number }>("SELECT count(*)::int AS c FROM products"));
    expect(n.c).toBe(2);
  });

  it("refuses to commit the same job twice", async () => {
    const file = csv([["SKU", "Item Name"], ["NEW-9", "New thing"]]);
    const { id } = await importFile("products", "items3.csv", file);
    await commit(id);
    await expect(commit(id)).rejects.toThrow(/already been completed/);
  });
});

describe("stock snapshot import", () => {
  it("posts the difference as an adjustment and is idempotent on re-import", async () => {
    await withTenant(ctx, (tx) => tx.query("INSERT INTO product_units (business_id, product_id, unit_code, factor_to_base) SELECT business_id, id, 'coil', 90 FROM products WHERE sku = 'WIRE-25'"));
    const file = csv([["Item Code", "Item Name", "Closing Stock", "Unit"], ["MCB-16", "", "36", "pcs"], ["K-16", "", "1", ""], ["WIRE-25", "", "4", "coil"]]);
    const first = await importFile("stock_snapshot", "stock.csv", file);
    // K-16 is MCB-16's supplier alias → duplicate product in one stock file is an error
    expect(first.summary.errors).toBe(1);
    await commit(first.id);
    expect(await stock("MCB-16")).toBe(36);
    expect(await stock("WIRE-25")).toBe(360);

    const again = await importFile("stock_snapshot", "stock.csv", file);
    const res = await commit(again.id);
    expect(res).toMatchObject({ stockCounted: 2, stockAdjusted: 0, stockUnchanged: 2 });
    expect(await stock("MCB-16")).toBe(36);
    expect(await stock("WIRE-25")).toBe(360);
  });

  it("rejects units without a configured conversion", async () => {
    const { summary } = await importFile("stock_snapshot", "stock-kg.csv", csv([["SKU", "Qty", "Unit"], ["MCB-16", "2", "kg"]]));
    expect(summary).toMatchObject({ valid: 0, errors: 1 });
    expect(summary.issueCounts.unit_mismatch).toBe(1);
  });
});

describe("sales history import", () => {
  const sales = csv([
    ["Date", "Invoice No", "Item Code", "Qty", "Rate", "Amount"],
    ["01/10/2026", "INV-1", "MCB-16", "5", "242", "1210"],
    ["01/10/2026", "INV-1", "MCB-16", "5", "242", "1210"], // same item twice on one bill
    ["02/10/2026", "INV-2", "WIRE-25", "1", "4140", "4140"],
    ["03/10/2026", "INV-3", "UNKNOWN", "1", "10", "10"],
    ["04/10/2026", "CN-1", "MCB-16", "-2", "242", "-484"],
  ]);

  it("records demand without touching stock", async () => {
    const before = await stock("MCB-16");
    const { id, summary } = await importFile("sales", "sales-oct.csv", sales);
    expect(summary).toMatchObject({ valid: 3, errors: 1, skipped: 1, dateFrom: "2026-10-01", dateTo: "2026-10-02" });
    expect(await commit(id)).toMatchObject({ salesLinesAdded: 3, alreadyImported: 0 });
    expect(await stock("MCB-16")).toBe(before);
    const q = await withTenant(ctx, (tx) => tx.one<{ q: string }>("SELECT sum(quantity) AS q FROM sales_lines"));
    expect(Number(q.q)).toBe(11);
  });

  it("does not double sales when the same or an overlapping file is imported again", async () => {
    const { id } = await importFile("sales", "sales-oct-again.csv", sales);
    expect(await commit(id)).toMatchObject({ salesLinesAdded: 0, alreadyImported: 3 });
    const q = await withTenant(ctx, (tx) => tx.one<{ q: string }>("SELECT sum(quantity) AS q FROM sales_lines"));
    expect(Number(q.q)).toBe(11);
  });

  it("stores per-base-unit prices when sold in a converted unit", async () => {
    const line = await withTenant(ctx, (tx) => tx.one<{ quantity: string; unit_price: string }>("SELECT quantity, unit_price FROM sales_lines l JOIN products p ON p.id = l.product_id WHERE p.sku = 'WIRE-25'"));
    // "1" with no unit means base unit (m); rate applies per m
    expect(Number(line.quantity)).toBe(1);
  });

  it("produces a row-level error report with the original columns", async () => {
    const { id } = await importFile("sales", "sales-bad.csv", sales);
    const issues = await withTenant(ctx, (tx) => listIssues(tx, ctx.businessId, id));
    expect(issues.some((i) => i.code === "unknown_product" && i.row_number === 5)).toBe(true);
    const job = await withTenant(ctx, (tx) => getImportJob(tx, ctx.businessId, id));
    const report = await withTenant(ctx, (tx) => errorReportCsv(tx, ctx.businessId, job));
    expect(report).toContain("UNKNOWN");
    expect(report.split("\r\n")[0]).toContain("Original: Item Code");
  });
});

describe("purchase history and supplier imports", () => {
  it("records price history without adding stock, and never overwrites a newer supplier price", async () => {
    const before = await stock("MCB-16");
    const file = csv([["Bill Date", "Item Code", "Qty", "Vendor", "Bill No", "Purchase Rate"], ["28/09/2026", "MCB-16", "48", "Kaveri Traders", "PB-1", "190"]]);
    const { id } = await importFile("purchases", "purchases.csv", file);
    expect(await commit(id)).toMatchObject({ purchaseLinesAdded: 1 });
    expect(await stock("MCB-16")).toBe(before);
    const sp = await withTenant(ctx, (tx) => tx.one<{ purchase_price: string }>("SELECT purchase_price FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE p.sku = 'MCB-16'"));
    // the product master import set 186 today; a September bill is older, so it is kept as history only
    expect(Number(sp.purchase_price)).toBe(186);
    const h = await withTenant(ctx, (tx) => tx.one<{ unit_cost: string }>("SELECT unit_cost FROM purchase_history_lines"));
    expect(Number(h.unit_cost)).toBe(190);
    // a newer bill does update it
    const newer = csv([["Bill Date", "Item Code", "Qty", "Vendor", "Bill No", "Purchase Rate"], [new Date().toLocaleDateString("en-GB"), "MCB-16", "12", "Kaveri Traders", "PB-2", "195"]]);
    const second = await importFile("purchases", "purchases-2.csv", newer);
    await commit(second.id);
    const sp2 = await withTenant(ctx, (tx) => tx.one<{ purchase_price: string }>("SELECT purchase_price FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE p.sku = 'MCB-16'"));
    expect(Number(sp2.purchase_price)).toBe(195);
  });

  it("upserts suppliers by name", async () => {
    const file = csv([["Supplier Name", "Mobile", "GSTIN", "Lead Time"], ["kaveri traders", "+91 99999 00000", "27ABCDE1234F1Z5", "6"], ["New Vendor", "", "bad", ""]]);
    const { id, summary } = await importFile("suppliers", "suppliers.csv", file);
    expect(summary.issueCounts.invalid_gstin).toBe(1);
    expect(await commit(id)).toEqual({ created: 1, updated: 1 });
    const s = await withTenant(ctx, (tx) => tx.one<{ phone: string; default_lead_time_days: number }>("SELECT phone, default_lead_time_days FROM suppliers WHERE lower(name) = 'kaveri traders'"));
    expect(s).toEqual({ phone: "+91 99999 00000", default_lead_time_days: 6 });
  });
});

describe("xlsx import", () => {
  it("imports an Excel workbook end to end", async () => {
    const { buildXlsx } = await import("@/lib/services/spreadsheet");
    const buf = await buildXlsx([{ name: "Items", headers: ["Item Code", "Product", "Unit"], rows: [["XL-1", "Excel item", "box"]] }]);
    const { id, summary } = await importFile("products", "items.xlsx", buf);
    expect(summary.valid).toBe(1);
    expect(await commit(id)).toMatchObject({ created: 1 });
  });
});
