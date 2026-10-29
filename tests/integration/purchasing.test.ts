import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import { parseBusinessSettings } from "@/lib/domain/settings";
import { analyzeWorkspace } from "@/lib/services/analysis";
import { confirmReceipt, createDraftPurchaseOrder, createReceipt, createSupplier, getPurchaseOrder, markSent, updateDraftPurchaseOrder, cancelPurchaseOrder } from "@/lib/services/purchasing";
import { createProduct } from "@/lib/services/catalog";
import { createBusiness } from "@/lib/services/workspaces";
import { resetTestDatabase } from "./db";

let ctx: { userId: string; businessId: string };
let supplierId: string;
let productId: string;
const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ctx, fn);
const onHand = async () => Number((await run((tx) => tx.one<{ on_hand: string }>("SELECT on_hand FROM products WHERE id = $1", [productId]))).on_hand);

beforeAll(async () => {
  await resetTestDatabase();
  const u = await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ('po@test.local', 'PO', 'x') RETURNING id"));
  const b = await createBusiness(u.id, { name: "PO Test Spares", industry: "auto_parts" });
  ctx = { userId: u.id, businessId: b.id };
  supplierId = (await run((tx) => createSupplier(tx, ctx, { name: "Test Brake Parts Co", default_lead_time_days: "5" })))!;
  productId = await run((tx) => createProduct(tx, ctx, { sku: "BP-1", name: "Brake pad set", base_unit: "set", purchase_cost: "450", min_stock: "10", max_stock: "40", preferred_supplier_id: supplierId, opening_stock: "4" }));
  await run((tx) => tx.query("INSERT INTO product_units (business_id, product_id, unit_code, factor_to_base) VALUES ($1, $2, 'box', 10)", [ctx.businessId, productId]));
});

afterAll(closePools);

describe("purchase orders and receipts", () => {
  let poId: string;
  let poLineId: string;

  it("creates a draft PO with supplier pricing and totals", async () => {
    const po = await run((tx) => createDraftPurchaseOrder(tx, ctx, supplierId, [{ productId, quantity: 36, unitPrice: null }], "recommendation"));
    expect(po.poNumber).toBe("PO-0001");
    poId = po.id;
    const d = await run((tx) => getPurchaseOrder(tx, ctx.businessId, poId));
    expect(d.po.status).toBe("draft");
    expect(d.po.total).toBe("16200.00");
    poLineId = d.lines[0].id;
  });

  it("does not count draft POs as inbound; counts sent POs exactly once", async () => {
    const settings = parseBusinessSettings({}).analysis;
    const before = await run((tx) => analyzeWorkspace(tx, ctx.businessId, settings, { timezone: "Asia/Kolkata" }));
    expect(before.products[0].reorder.inbound).toBe(0);
    // min/max fallback (no sales history): ROP 10, target 40, position 4 → 36
    expect(before.products[0].reorder.suggestedQty).toBe(36);
    await run((tx) => markSent(tx, ctx, poId));
    const after = await run((tx) => analyzeWorkspace(tx, ctx.businessId, settings, { timezone: "Asia/Kolkata" }));
    expect(after.products[0].reorder.inbound).toBe(36);
    expect(after.products[0].reorder.inventoryPosition).toBe(40);
    expect(after.products[0].reorder.suggestedQty).toBe(0);
  });

  it("only drafts can be edited", async () => {
    await expect(run((tx) => updateDraftPurchaseOrder(tx, ctx, poId, { lines: [] }))).rejects.toThrow(/Only draft/);
  });

  it("receives partially, idempotently, with unit conversion", async () => {
    const key = "receipt-key-0001";
    const input = { supplierId, purchaseOrderId: poId, idempotencyKey: key, lines: [{ productId, poLineId, quantity: 2, unit: "box", unitCost: 4500 }] };
    const r1 = await run((tx) => createReceipt(tx, ctx, input));
    const r2 = await run((tx) => createReceipt(tx, ctx, input)); // double submit
    expect(r2).toEqual({ id: r1.id, existing: true });
    const c1 = await run((tx) => confirmReceipt(tx, ctx, r1.id));
    const c2 = await run((tx) => confirmReceipt(tx, ctx, r1.id)); // double confirm
    expect(c1.movements).toBe(1);
    expect(c2.alreadyConfirmed).toBe(true);
    expect(await onHand()).toBe(24); // 4 + 2 boxes × 10
    const d = await run((tx) => getPurchaseOrder(tx, ctx.businessId, poId));
    expect(d.po.status).toBe("partially_received");
    expect(Number(d.lines[0].received_qty_base)).toBe(20);
    const mv = await run((tx) => tx.one<{ unit_cost: string }>("SELECT unit_cost FROM inventory_movements WHERE movement_type = 'receipt'"));
    expect(Number(mv.unit_cost)).toBe(450); // per base unit
  });

  it("closes the PO when everything has arrived and stops counting it as inbound", async () => {
    const r = await run((tx) => createReceipt(tx, ctx, { supplierId, purchaseOrderId: poId, idempotencyKey: "receipt-key-0002", lines: [{ productId, poLineId, quantity: 16 }] }));
    await run((tx) => confirmReceipt(tx, ctx, r.id));
    const d = await run((tx) => getPurchaseOrder(tx, ctx.businessId, poId));
    expect(d.po.status).toBe("received");
    expect(await onHand()).toBe(40);
    const a = await run((tx) => analyzeWorkspace(tx, ctx.businessId, parseBusinessSettings({}).analysis, { timezone: "Asia/Kolkata" }));
    expect(a.products[0].reorder.inbound).toBe(0);
    await expect(run((tx) => createReceipt(tx, ctx, { supplierId, purchaseOrderId: poId, idempotencyKey: "receipt-key-0003", lines: [{ productId, poLineId, quantity: 1 }] }))).rejects.toThrow(/closed/);
  });

  it("rejects receipts in units without a conversion, and against draft POs", async () => {
    const po = await run((tx) => createDraftPurchaseOrder(tx, ctx, supplierId, [{ productId, quantity: 5, unitPrice: 400 }]));
    await expect(run((tx) => createReceipt(tx, ctx, { supplierId, purchaseOrderId: po.id, idempotencyKey: "receipt-key-0004", lines: [{ productId, quantity: 1 }] }))).rejects.toThrow(/Mark the purchase order as sent/);
    await expect(run((tx) => createReceipt(tx, ctx, { supplierId, idempotencyKey: "receipt-key-0005", lines: [{ productId, quantity: 1, unit: "kg" }] }))).rejects.toThrow(/No conversion configured/);
    await run((tx) => cancelPurchaseOrder(tx, ctx, po.id));
    expect((await run((tx) => getPurchaseOrder(tx, ctx.businessId, po.id))).po.status).toBe("cancelled");
  });

  it("never produces negative order suggestions after receiving more than needed", async () => {
    const a = await run((tx) => analyzeWorkspace(tx, ctx.businessId, parseBusinessSettings({}).analysis, { timezone: "Asia/Kolkata" }));
    expect(a.products[0].reorder.suggestedQty).toBe(0);
  });
});
