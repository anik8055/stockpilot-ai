"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formObject, runAction, type ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { loadEntitlements } from "@/lib/queries";
import { requireFeature } from "@/lib/services/entitlements";
import {
  cancelPurchaseOrder,
  confirmReceipt,
  createDraftPurchaseOrder,
  createReceipt,
  createSupplier,
  markSent,
  setSupplierActive,
  updateDraftPurchaseOrder,
  updateSupplier,
} from "@/lib/services/purchasing";
import { analyzeWorkspace } from "@/lib/services/analysis";
import { requireTenant, tx } from "@/lib/tenant";

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

export async function createSupplierAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("supplier.create", async () => {
    const t = await requireTenant("suppliers.edit");
    const id = await tx(t, (db) => createSupplier(db, t, formObject(fd)));
    redirect(`/app/suppliers/${id}`);
  });
}

export async function updateSupplierAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("supplier.update", async () => {
    const t = await requireTenant("suppliers.edit");
    const id = String(fd.get("id"));
    await tx(t, (db) => updateSupplier(db, t, id, formObject(fd)));
    revalidatePath(`/app/suppliers/${id}`);
    return { ok: true, message: "Supplier saved." };
  });
}

export async function toggleSupplierAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("supplier.toggle", async () => {
    const t = await requireTenant("suppliers.edit");
    const id = String(fd.get("id"));
    if (!isId(id)) throw new AppError("Invalid supplier.");
    await tx(t, (db) => setSupplierActive(db, t, id, fd.get("active") === "true"));
    revalidatePath(`/app/suppliers/${id}`);
    return { ok: true };
  });
}

/**
 * Creates a draft PO for one supplier from the purchase list. Quantities come from the form (the user may have
 * edited them); the recommendation shown at the time is stored with each line for traceability.
 */
export async function draftFromRecommendationsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("po.from-recommendations", async () => {
    const t = await requireTenant("purchasing.draft");
    requireFeature(await loadEntitlements(t), "reorder_engine");
    const supplierId = String(fd.get("supplierId") ?? "");
    if (!isId(supplierId)) throw new AppError("Choose a supplier for these items first.");
    const picked: { productId: string; quantity: number }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("qty_") || typeof v !== "string") continue;
      const productId = k.slice(4);
      if (!isId(productId) || fd.get(`pick_${productId}`) !== "on") continue;
      const q = Number(v.replace(/,/g, ""));
      if (!Number.isFinite(q) || q < 0) throw new AppError("Quantities must be positive numbers.");
      if (q > 0) picked.push({ productId, quantity: q });
    }
    if (picked.length === 0) throw new AppError("Tick at least one item with a quantity above zero.");
    const result = await tx(t, async (db) => {
      const a = await analyzeWorkspace(db, t.businessId, t.business.settings.analysis, { timezone: t.business.timezone, productIds: picked.map((p) => p.productId) });
      const recs = new Map(a.products.map((p) => [p.id, p]));
      return createDraftPurchaseOrder(
        db,
        t,
        supplierId,
        picked.map((p) => {
          const r = recs.get(p.productId)?.reorder;
          return {
            productId: p.productId,
            quantity: p.quantity,
            unitPrice: recs.get(p.productId)?.unitCost ?? null,
            recommendation: r ? { suggestedQty: r.suggestedQty, reorderPoint: r.reorderPoint, targetLevel: r.targetLevel, averageDailyDemand: r.averageDailyDemand, method: r.method, provisional: r.provisional, edited: r.suggestedQty !== p.quantity, at: new Date().toISOString() } : undefined,
          };
        }),
        "recommendation",
      );
    });
    redirect(`/app/purchase-orders/${result.id}?created=1`);
  });
}

export async function updatePoAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("po.update", async () => {
    const t = await requireTenant("purchasing.draft");
    const poId = String(fd.get("poId"));
    const lineIds = fd.getAll("lineId").map(String);
    const lines = lineIds.map((id) => ({ id, quantity: fd.get(`q_${id}`), unit_price: fd.get(`p_${id}`), tax_rate: fd.get(`t_${id}`) || 0 }));
    const remove = lineIds.filter((id) => fd.get(`rm_${id}`) === "on");
    const addProduct = String(fd.get("addProductId") ?? "");
    const addQty = Number(fd.get("addQty") ?? 0);
    await tx(t, (db) =>
      updateDraftPurchaseOrder(db, t, poId, {
        expected_date: String(fd.get("expected_date") ?? "") || null,
        notes: String(fd.get("notes") ?? ""),
        lines: lines.filter((l) => !remove.includes(l.id)),
        remove,
        add: isId(addProduct) && addQty > 0 ? [{ productId: addProduct, quantity: addQty }] : [],
      }),
    );
    revalidatePath(`/app/purchase-orders/${poId}`);
    return { ok: true, message: "Purchase order saved." };
  });
}

export async function markSentAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("po.sent", async () => {
    const t = await requireTenant("purchasing.approve");
    const poId = String(fd.get("poId"));
    await tx(t, (db) => markSent(db, t, poId));
    redirect(`/app/purchase-orders/${poId}?sent=1`);
  });
}

export async function cancelPoAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("po.cancel", async () => {
    const t = await requireTenant("purchasing.approve");
    const poId = String(fd.get("poId"));
    await tx(t, (db) => cancelPurchaseOrder(db, t, poId));
    revalidatePath(`/app/purchase-orders/${poId}`);
    return { ok: true, message: "Purchase order cancelled." };
  });
}

/** Receive goods against a PO: create + confirm in one transaction; a repeated submit with the same key is a no-op. */
export async function receiveGoodsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("po.receive", async () => {
    const t = await requireTenant("receipts.confirm");
    const poId = String(fd.get("poId"));
    const supplierId = String(fd.get("supplierId"));
    const lines = fd.getAll("lineId").map((id) => ({
      productId: String(fd.get(`prod_${id}`)),
      poLineId: String(id),
      quantity: String(fd.get(`rq_${id}`) || "0").replace(/,/g, ""),
      unitCost: fd.get(`rc_${id}`) ? String(fd.get(`rc_${id}`)) : null,
    }));
    const res = await tx(t, async (db) => {
      const r = await createReceipt(db, t, {
        supplierId,
        purchaseOrderId: poId,
        idempotencyKey: String(fd.get("idempotencyKey") ?? ""),
        supplierInvoiceRef: String(fd.get("invoiceRef") ?? "") || null,
        receivedOn: String(fd.get("receivedOn") ?? "") || null,
        lines: lines as never,
      });
      const c = await confirmReceipt(db, t, r.id);
      return { ...c, existing: r.existing };
    });
    const q = new URLSearchParams(res.existing || res.alreadyConfirmed ? { received: "duplicate" } : { received: String(res.movements), ...(res.overReceived.length ? { over: res.overReceived.join(",").slice(0, 300) } : {}) });
    redirect(`/app/purchase-orders/${poId}?${q}`);
  });
}
