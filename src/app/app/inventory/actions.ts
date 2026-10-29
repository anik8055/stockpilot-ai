"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formObject, runAction, type ActionResult } from "@/lib/action-result";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  addAlias,
  addUnitConversion,
  adjustStock,
  createProduct,
  removeAlias,
  removeSupplierProduct,
  removeUnitConversion,
  setProductActive,
  updateProduct,
  upsertSupplierProduct,
} from "@/lib/services/catalog";
import { requireTenant, tx } from "@/lib/tenant";

const idOf = (fd: FormData, k = "id") => {
  const v = String(fd.get(k) ?? "");
  if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error("invalid id");
  return v;
};

export async function createProductAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.create", async () => {
    const t = await requireTenant("inventory.edit");
    await rateLimit(`product-create:${t.userId}`, 120, 3600);
    const input = formObject(fd);
    const id = await tx(t, (db) => createProduct(db, t, input as never));
    redirect(`/app/inventory/${id}?created=1`);
  });
}

export async function updateProductAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.update", async () => {
    const t = await requireTenant("inventory.edit");
    const id = idOf(fd);
    await tx(t, (db) => updateProduct(db, t, id, formObject(fd) as never));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true, message: "Product saved." };
  });
}

export async function toggleActiveAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.toggle", async () => {
    const t = await requireTenant("inventory.edit");
    const id = idOf(fd);
    const active = fd.get("active") === "true";
    await tx(t, (db) => setProductActive(db, t, id, active));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true, message: active ? "Product restored." : "Product archived. Its history is kept." };
  });
}

export async function adjustStockAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.adjust", async () => {
    const t = await requireTenant("inventory.adjust");
    const id = idOf(fd);
    const r = await tx(t, (db) => adjustStock(db, t, id, { counted: String(fd.get("counted") ?? ""), reason: String(fd.get("reason") ?? "") } as never));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true, message: r.delta === 0 ? "Stock already matches the count — nothing changed." : `Stock adjusted by ${r.delta > 0 ? "+" : ""}${r.delta}.` };
  });
}

export async function addUnitAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.unit", async () => {
    const t = await requireTenant("inventory.edit");
    const id = idOf(fd);
    await tx(t, (db) => addUnitConversion(db, t, id, String(fd.get("unit") ?? ""), String(fd.get("factor") ?? "")));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true, message: "Unit conversion added." };
  });
}

export async function removeUnitAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.unit.remove", async () => {
    const t = await requireTenant("inventory.edit");
    const id = idOf(fd);
    await tx(t, (db) => removeUnitConversion(db, t, id, idOf(fd, "unitId")));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true };
  });
}

export async function addAliasAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.alias", async () => {
    const t = await requireTenant("inventory.edit");
    const id = idOf(fd);
    await tx(t, (db) => addAlias(db, t, id, { value: String(fd.get("value") ?? ""), type: String(fd.get("type") ?? "alias"), supplierId: String(fd.get("supplierId") ?? "") || null }));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true, message: "Code added. Imports and invoices will now recognise it." };
  });
}

export async function removeAliasAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.alias.remove", async () => {
    const t = await requireTenant("inventory.edit");
    const id = idOf(fd);
    await tx(t, (db) => removeAlias(db, t, id, idOf(fd, "aliasId")));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true };
  });
}

export async function supplierTermsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.supplier", async () => {
    const t = await requireTenant("suppliers.edit");
    const id = idOf(fd);
    await tx(t, (db) => upsertSupplierProduct(db, t, id, formObject(fd) as never));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true, message: "Supplier terms saved." };
  });
}

export async function removeSupplierTermsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("product.supplier.remove", async () => {
    const t = await requireTenant("suppliers.edit");
    const id = idOf(fd);
    await tx(t, (db) => removeSupplierProduct(db, t, id, idOf(fd, "spId")));
    revalidatePath(`/app/inventory/${id}`);
    return { ok: true };
  });
}
