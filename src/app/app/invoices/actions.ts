"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/action-result";
import { AppError } from "@/lib/errors";
import { createReceiptFromInvoice, discardInvoice, saveReview } from "@/lib/services/invoices";
import { cancelDraftReceipt, confirmReceipt } from "@/lib/services/purchasing";
import { requireTenant, tx } from "@/lib/tenant";

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new AppError(`"${s}" is not a number.`);
  return n;
};

function reviewFrom(fd: FormData) {
  const lineKeys = fd.getAll("line").map(String);
  return {
    supplier_id: isId(fd.get("supplier_id")) ? String(fd.get("supplier_id")) : null,
    invoice_number: String(fd.get("invoice_number") ?? "").trim() || null,
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("invoice_date") ?? "")) ? String(fd.get("invoice_date")) : null,
    subtotal: numOrNull(fd.get("subtotal")),
    tax_total: numOrNull(fd.get("tax_total")),
    total: numOrNull(fd.get("total")),
    lines: lineKeys.map((k) => ({
      id: isId(fd.get(`id_${k}`)) ? String(fd.get(`id_${k}`)) : null,
      include: fd.get(`inc_${k}`) === "on",
      description: String(fd.get(`d_${k}`) ?? "").trim() || "(no description)",
      quantity: numOrNull(fd.get(`q_${k}`)),
      unit: String(fd.get(`u_${k}`) ?? "").trim() || null,
      unit_price: numOrNull(fd.get(`r_${k}`)),
      discount_amount: numOrNull(fd.get(`ds_${k}`)),
      line_total: numOrNull(fd.get(`a_${k}`)),
      product_id: isId(fd.get(`p_${k}`)) ? String(fd.get(`p_${k}`)) : null,
    })),
  };
}

export async function saveInvoiceAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("invoice.review", async () => {
    const t = await requireTenant("invoices.upload");
    const id = String(fd.get("invoiceId"));
    const check = await tx(t, (db) => saveReview(db, t, id, reviewFrom(fd)));
    const intent = String(fd.get("intent") ?? "save");
    if (intent === "receive") {
      if (!check.consistent && fd.get("acceptMismatch") !== "on") {
        revalidatePath(`/app/invoices/${id}`);
        return { ok: false, message: "The amounts do not reconcile. Correct them, or tick “Totals checked — continue anyway” if the difference is explained (e.g. freight)." };
      }
      const poId = isId(fd.get("purchaseOrderId")) ? String(fd.get("purchaseOrderId")) : null;
      const r = await tx(t, (db) => createReceiptFromInvoice(db, t, id, { purchaseOrderId: poId, idempotencyKey: String(fd.get("idempotencyKey") ?? "") }));
      redirect(`/app/receipts/${r.id}`);
    }
    revalidatePath(`/app/invoices/${id}`);
    return { ok: true, message: check.consistent ? "Saved. Amounts reconcile." : "Saved. Some amounts still do not reconcile — see the checks above." };
  });
}

export async function discardInvoiceAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("invoice.discard", async () => {
    const t = await requireTenant("invoices.upload");
    await tx(t, (db) => discardInvoice(db, t, String(fd.get("invoiceId"))));
    redirect("/app/invoices");
  });
}

export async function confirmReceiptAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("receipt.confirm", async () => {
    const t = await requireTenant("receipts.confirm");
    const id = String(fd.get("receiptId"));
    const r = await tx(t, (db) => confirmReceipt(db, t, id));
    redirect(`/app/receipts/${id}?confirmed=${r.alreadyConfirmed ? "again" : r.movements}`);
  });
}

export async function cancelReceiptAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("receipt.cancel", async () => {
    const t = await requireTenant("receipts.confirm");
    const id = String(fd.get("receiptId"));
    await tx(t, (db) => cancelDraftReceipt(db, t, id));
    redirect(`/app/receipts/${id}`);
  });
}
