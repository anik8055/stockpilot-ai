import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { lineTotal, money, sumMoney } from "@/lib/domain/money";
import { normalizeUnit, toBaseQuantity } from "@/lib/domain/units";
import { AppError, fromPgError, NotFoundError } from "@/lib/errors";

type Ctx = { userId: string; businessId: string };

const uuid = z.string().regex(/^[0-9a-f-]{36}$/, "Invalid ID");

async function audit(db: Tx, ctx: Ctx, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5,$6)", [
    ctx.businessId, ctx.userId, action, entityType, entityId, JSON.stringify(metadata),
  ]);
}

/** Next human-readable number per business (PO-0001, GRN-0001). Row lock makes it safe under concurrency. */
export async function nextNumber(db: Tx, businessId: string, kind: "po" | "grn", prefix: string) {
  const r = await db.one<{ v: number }>(
    `INSERT INTO document_counters (business_id, kind, next_value) VALUES ($1, $2, 2)
     ON CONFLICT (business_id, kind) DO UPDATE SET next_value = document_counters.next_value + 1
     RETURNING next_value - 1 AS v`,
    [businessId, kind],
  );
  return `${prefix}-${String(r.v).padStart(4, "0")}`;
}

// ------------------------------------------------------------------ suppliers

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required").max(200),
  contact_person: optText(120),
  phone: optText(40),
  email: z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email"),
  gstin: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || /^[0-9]{2}[A-Z0-9]{13}$/.test(v), "GSTIN should be 15 characters"),
  address: optText(400),
  city: optText(80),
  state: optText(80),
  default_lead_time_days: z.union([z.string(), z.number()]).optional().nullable().transform((v, c) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      c.addIssue({ code: "custom", message: "Lead time must be a whole number of days (0–365)" });
      return z.NEVER;
    }
    return n;
  }),
  payment_terms: optText(120),
  notes: optText(1000),
});

export async function listSuppliers(db: Tx, businessId: string) {
  return db.query<{ id: string; name: string; city: string | null; phone: string | null; default_lead_time_days: number | null; active: boolean; products: number; open_pos: number; purchased_90d: string | null }>(
    `SELECT s.id, s.name, s.city, s.phone, s.default_lead_time_days, s.active,
            (SELECT count(*)::int FROM supplier_products sp WHERE sp.supplier_id = s.id) AS products,
            (SELECT count(*)::int FROM purchase_orders o WHERE o.supplier_id = s.id AND o.status IN ('sent','partially_received')) AS open_pos,
            (SELECT sum(line_total) FROM purchase_history_lines h WHERE h.supplier_id = s.id AND h.purchased_on >= current_date - 90) AS purchased_90d
       FROM suppliers s WHERE s.business_id = $1 ORDER BY s.active DESC, s.name`,
    [businessId],
  );
}

export async function getSupplier(db: Tx, businessId: string, id: string) {
  uuid.parse(id);
  const s = await db.maybeOne<Record<string, unknown> & { id: string; name: string }>("SELECT * FROM suppliers WHERE business_id = $1 AND id = $2", [businessId, id]);
  if (!s) throw new NotFoundError("Supplier");
  const products = await db.query<{ product_id: string; sku: string; name: string; supplier_sku: string | null; purchase_price: string | null; moq: string | null; pack_size: string | null; preferred: boolean }>(
    `SELECT p.id AS product_id, p.sku, p.name, sp.supplier_sku, sp.purchase_price, sp.moq, sp.pack_size, (p.preferred_supplier_id = sp.supplier_id) AS preferred
       FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE sp.supplier_id = $1 ORDER BY p.name LIMIT 500`,
    [id],
  );
  const orders = await db.query<{ id: string; po_number: string; status: string; order_date: string; total: string }>(
    "SELECT id, po_number, status, order_date, total FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2 ORDER BY created_at DESC LIMIT 20",
    [businessId, id],
  );
  return { supplier: s, products, orders };
}

export async function createSupplier(db: Tx, ctx: Ctx, input: unknown) {
  const d = supplierSchema.parse(input);
  try {
    const r = await db.one<{ id: string }>(
      `INSERT INTO suppliers (business_id, name, contact_person, phone, email, gstin, address, city, state, default_lead_time_days, payment_terms, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [ctx.businessId, d.name, d.contact_person, d.phone, d.email, d.gstin, d.address, d.city, d.state, d.default_lead_time_days, d.payment_terms, d.notes],
    );
    await audit(db, ctx, "supplier.created", "supplier", r.id, { name: d.name });
    return r.id;
  } catch (err) {
    fromPgError(err, "A supplier with this name already exists.");
  }
}

export async function updateSupplier(db: Tx, ctx: Ctx, id: string, input: unknown) {
  uuid.parse(id);
  const d = supplierSchema.parse(input);
  try {
    const rows = await db.query(
      `UPDATE suppliers SET name=$3, contact_person=$4, phone=$5, email=$6, gstin=$7, address=$8, city=$9, state=$10, default_lead_time_days=$11,
              payment_terms=$12, notes=$13, updated_at=now() WHERE business_id=$1 AND id=$2 RETURNING id`,
      [ctx.businessId, id, d.name, d.contact_person, d.phone, d.email, d.gstin, d.address, d.city, d.state, d.default_lead_time_days, d.payment_terms, d.notes],
    );
    if (!rows.length) throw new NotFoundError("Supplier");
  } catch (err) {
    if (err instanceof AppError) throw err;
    fromPgError(err, "A supplier with this name already exists.");
  }
  await audit(db, ctx, "supplier.updated", "supplier", id);
}

export async function setSupplierActive(db: Tx, ctx: Ctx, id: string, active: boolean) {
  await db.query("UPDATE suppliers SET active = $3, updated_at = now() WHERE business_id = $1 AND id = $2", [ctx.businessId, id, active]);
  await audit(db, ctx, active ? "supplier.restored" : "supplier.archived", "supplier", id);
}

// ------------------------------------------------------------------ purchase orders

export type DraftLineInput = { productId: string; quantity: number; unitPrice: number | null; recommendation?: Record<string, unknown> };

/** Creates one draft PO for a supplier. Quantities are in each product's base unit. Nothing is sent anywhere. */
export async function createDraftPurchaseOrder(db: Tx, ctx: Ctx, supplierId: string, lines: DraftLineInput[], source: "manual" | "recommendation" = "manual", notes?: string) {
  uuid.parse(supplierId);
  const valid = lines.filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
  if (valid.length === 0) throw new AppError("Add at least one item with a quantity above zero.");
  const supplier = await db.maybeOne<{ id: string; lead: number | null }>("SELECT id, default_lead_time_days AS lead FROM suppliers WHERE business_id = $1 AND id = $2", [ctx.businessId, supplierId]);
  if (!supplier) throw new NotFoundError("Supplier");
  const products = await db.query<{ id: string; base_unit: string; cost: string | null; sp_price: string | null }>(
    `SELECT p.id, p.base_unit, p.purchase_cost AS cost, sp.purchase_price AS sp_price
       FROM products p LEFT JOIN supplier_products sp ON sp.product_id = p.id AND sp.supplier_id = $2
      WHERE p.business_id = $1 AND p.id = ANY($3::uuid[])`,
    [ctx.businessId, supplierId, valid.map((l) => l.productId)],
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  if (byId.size !== new Set(valid.map((l) => l.productId)).size) throw new AppError("One of the products was not found.");
  const poNumber = await nextNumber(db, ctx.businessId, "po", "PO");
  const po = await db.one<{ id: string }>(
    `INSERT INTO purchase_orders (business_id, po_number, supplier_id, status, source, expected_date, notes, created_by)
     VALUES ($1,$2,$3,'draft',$4, current_date + make_interval(days => coalesce($5, 7)), $6, $7) RETURNING id`,
    [ctx.businessId, poNumber, supplierId, source, supplier.lead, notes ?? null, ctx.userId],
  );
  let n = 0;
  for (const l of valid) {
    const p = byId.get(l.productId)!;
    const price = l.unitPrice ?? (p.sp_price !== null ? Number(p.sp_price) : p.cost !== null ? Number(p.cost) : 0);
    n++;
    await db.query(
      `INSERT INTO purchase_order_lines (business_id, purchase_order_id, line_no, product_id, quantity, unit, unit_factor, unit_price, line_total, recommendation)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9)`,
      [ctx.businessId, po.id, n, l.productId, l.quantity, p.base_unit, price, lineTotal(l.quantity, price).toFixed(2), l.recommendation ? JSON.stringify(l.recommendation) : null],
    );
  }
  await recalcTotals(db, ctx.businessId, po.id);
  await audit(db, ctx, "po.drafted", "purchase_order", po.id, { poNumber, lines: n, source });
  return { id: po.id, poNumber };
}

export async function recalcTotals(db: Tx, businessId: string, poId: string) {
  const lines = await db.query<{ line_total: string; tax_rate: string }>("SELECT line_total, tax_rate FROM purchase_order_lines WHERE business_id = $1 AND purchase_order_id = $2", [businessId, poId]);
  const subtotal = sumMoney(lines.map((l) => l.line_total));
  const tax = sumMoney(lines.map((l) => money(Number(l.line_total) * (Number(l.tax_rate) / 100))));
  await db.query("UPDATE purchase_orders SET subtotal = $3, tax_total = $4, total = $5, updated_at = now() WHERE business_id = $1 AND id = $2", [businessId, poId, subtotal.toFixed(2), tax.toFixed(2), subtotal.plus(tax).toFixed(2)]);
}

export async function listPurchaseOrders(db: Tx, businessId: string, status?: string) {
  return db.query<{ id: string; po_number: string; status: string; supplier_name: string; order_date: string; expected_date: string | null; total: string; lines: number; source: string }>(
    `SELECT o.id, o.po_number, o.status, s.name AS supplier_name, o.order_date, o.expected_date, o.total, o.source,
            (SELECT count(*)::int FROM purchase_order_lines l WHERE l.purchase_order_id = o.id) AS lines
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.business_id = $1 AND ($2::text IS NULL OR o.status = $2)
      ORDER BY o.created_at DESC LIMIT 200`,
    [businessId, status ?? null],
  );
}

export type PurchaseOrderDetail = Awaited<ReturnType<typeof getPurchaseOrder>>;

export async function getPurchaseOrder(db: Tx, businessId: string, id: string) {
  uuid.parse(id);
  const po = await db.maybeOne<{
    id: string; po_number: string; status: "draft" | "sent" | "partially_received" | "received" | "cancelled"; supplier_id: string; order_date: string; expected_date: string | null;
    notes: string | null; subtotal: string; tax_total: string; total: string; sent_at: Date | null; cancelled_at: Date | null; created_at: Date; source: string;
    supplier_name: string; supplier_gstin: string | null; supplier_address: string | null; supplier_city: string | null; supplier_state: string | null; supplier_phone: string | null; supplier_email: string | null;
  }>(
    `SELECT o.*, s.name AS supplier_name, s.gstin AS supplier_gstin, s.address AS supplier_address, s.city AS supplier_city, s.state AS supplier_state,
            s.phone AS supplier_phone, s.email AS supplier_email
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.business_id = $1 AND o.id = $2`,
    [businessId, id],
  );
  if (!po) throw new NotFoundError("Purchase order");
  const lines = await db.query<{
    id: string; line_no: number; product_id: string; sku: string; name: string; supplier_sku: string | null; quantity: string; unit: string; unit_factor: string; quantity_base: string;
    unit_price: string; tax_rate: string; line_total: string; received_qty_base: string; base_unit: string; recommendation: Record<string, unknown> | null;
  }>(
    `SELECT l.id, l.line_no, l.product_id, p.sku, p.name, sp.supplier_sku, l.quantity, l.unit, l.unit_factor, l.quantity_base, l.unit_price, l.tax_rate, l.line_total,
            l.received_qty_base, p.base_unit, l.recommendation
       FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
       LEFT JOIN supplier_products sp ON sp.product_id = l.product_id AND sp.supplier_id = $3
      WHERE l.business_id = $1 AND l.purchase_order_id = $2 ORDER BY l.line_no`,
    [businessId, id, po.supplier_id],
  );
  const receipts = await db.query<{ id: string; receipt_number: string; status: string; received_on: string; supplier_invoice_ref: string | null; confirmed_at: Date | null; lines: number }>(
    `SELECT r.id, r.receipt_number, r.status, r.received_on, r.supplier_invoice_ref, r.confirmed_at, (SELECT count(*)::int FROM goods_receipt_lines g WHERE g.goods_receipt_id = r.id) AS lines
       FROM goods_receipts r WHERE r.business_id = $1 AND r.purchase_order_id = $2 ORDER BY r.created_at DESC`,
    [businessId, id],
  );
  return { po, lines, receipts };
}

const lineUpdateSchema = z.object({
  id: uuid,
  quantity: z.coerce.number().positive("Quantity must be more than zero").max(1e9),
  unit_price: z.coerce.number().min(0, "Price cannot be negative").max(1e9),
  tax_rate: z.coerce.number().min(0).max(100),
});

export async function updateDraftPurchaseOrder(db: Tx, ctx: Ctx, poId: string, input: { expected_date?: string | null; notes?: string | null; lines: unknown[]; remove?: string[]; add?: { productId: string; quantity: number }[] }) {
  const po = await lockPo(db, ctx, poId);
  if (po.status !== "draft") throw new AppError("Only draft purchase orders can be edited.");
  const lines = input.lines.map((l) => lineUpdateSchema.parse(l));
  for (const l of lines) {
    await db.query(
      "UPDATE purchase_order_lines SET quantity = $4, unit_price = $5, tax_rate = $6, line_total = $7 WHERE business_id = $1 AND purchase_order_id = $2 AND id = $3",
      [ctx.businessId, poId, l.id, l.quantity, l.unit_price, l.tax_rate, lineTotal(l.quantity, l.unit_price).toFixed(2)],
    );
  }
  for (const r of input.remove ?? []) await db.query("DELETE FROM purchase_order_lines WHERE business_id = $1 AND purchase_order_id = $2 AND id = $3", [ctx.businessId, poId, uuid.parse(r)]);
  for (const a of input.add ?? []) {
    if (!(a.quantity > 0)) continue;
    const p = await db.maybeOne<{ base_unit: string; price: string | null }>(
      `SELECT p.base_unit, coalesce(sp.purchase_price, p.purchase_cost) AS price FROM products p
         LEFT JOIN supplier_products sp ON sp.product_id = p.id AND sp.supplier_id = $3 WHERE p.business_id = $1 AND p.id = $2`,
      [ctx.businessId, uuid.parse(a.productId), po.supplier_id],
    );
    if (!p) throw new NotFoundError("Product");
    const price = Number(p.price ?? 0);
    await db.query(
      `INSERT INTO purchase_order_lines (business_id, purchase_order_id, line_no, product_id, quantity, unit, unit_factor, unit_price, line_total)
       VALUES ($1,$2,(SELECT coalesce(max(line_no),0)+1 FROM purchase_order_lines WHERE purchase_order_id = $2),$3,$4,$5,1,$6,$7)`,
      [ctx.businessId, poId, a.productId, a.quantity, p.base_unit, price, lineTotal(a.quantity, price).toFixed(2)],
    );
  }
  const left = await db.one<{ c: number }>("SELECT count(*)::int AS c FROM purchase_order_lines WHERE purchase_order_id = $1", [poId]);
  if (left.c === 0) throw new AppError("A purchase order needs at least one line. Cancel it instead.");
  await db.query("UPDATE purchase_orders SET expected_date = $3, notes = $4, updated_at = now() WHERE business_id = $1 AND id = $2", [
    ctx.businessId, poId, input.expected_date || null, input.notes?.trim().slice(0, 2000) || null,
  ]);
  await recalcTotals(db, ctx.businessId, poId);
  await audit(db, ctx, "po.updated", "purchase_order", poId);
}

async function lockPo(db: Tx, ctx: Ctx, poId: string) {
  uuid.parse(poId);
  const po = await db.maybeOne<{ id: string; status: string; supplier_id: string; po_number: string }>("SELECT id, status, supplier_id, po_number FROM purchase_orders WHERE business_id = $1 AND id = $2 FOR UPDATE", [ctx.businessId, poId]);
  if (!po) throw new NotFoundError("Purchase order");
  return po;
}

/** Records that the user sent the PO (WhatsApp, email, in person). It does not mean the supplier accepted it. */
export async function markSent(db: Tx, ctx: Ctx, poId: string) {
  const po = await lockPo(db, ctx, poId);
  if (po.status !== "draft") throw new AppError("Only draft orders can be marked as sent.");
  await db.query("UPDATE purchase_orders SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1", [poId]);
  await audit(db, ctx, "po.marked_sent", "purchase_order", poId, { poNumber: po.po_number });
}

export async function cancelPurchaseOrder(db: Tx, ctx: Ctx, poId: string) {
  const po = await lockPo(db, ctx, poId);
  if (po.status === "received" || po.status === "cancelled") throw new AppError("This order can no longer be cancelled.");
  const confirmed = await db.one<{ c: number }>("SELECT count(*)::int AS c FROM goods_receipts WHERE purchase_order_id = $1 AND status = 'confirmed'", [poId]);
  await db.query("UPDATE purchase_orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1", [poId]);
  await audit(db, ctx, "po.cancelled", "purchase_order", poId, { poNumber: po.po_number, hadReceipts: confirmed.c > 0 });
}

// ------------------------------------------------------------------ goods receipts

export const receiptLineSchema = z.object({
  productId: uuid,
  poLineId: uuid.nullable().optional(),
  quantity: z.coerce.number().min(0).max(1e9),
  unit: z.string().trim().max(20).optional().nullable(),
  unitCost: z.coerce.number().min(0).max(1e9).nullable().optional(),
});

export type ReceiptInput = {
  supplierId: string;
  purchaseOrderId?: string | null;
  invoiceDocumentId?: string | null;
  supplierInvoiceRef?: string | null;
  receivedOn?: string | null;
  notes?: string | null;
  idempotencyKey: string;
  lines: z.input<typeof receiptLineSchema>[];
};

/**
 * Creates a goods receipt (draft). Idempotent on idempotencyKey: submitting the same form twice returns the
 * existing receipt instead of creating a second one.
 */
export async function createReceipt(db: Tx, ctx: Ctx, input: ReceiptInput): Promise<{ id: string; existing: boolean }> {
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(input.idempotencyKey)) throw new AppError("Missing receipt key — reload the page and try again.");
  const existing = await db.maybeOne<{ id: string }>("SELECT id FROM goods_receipts WHERE business_id = $1 AND idempotency_key = $2", [ctx.businessId, input.idempotencyKey]);
  if (existing) return { id: existing.id, existing: true };

  const lines = input.lines.map((l) => receiptLineSchema.parse(l)).filter((l) => l.quantity > 0);
  if (lines.length === 0) throw new AppError("Enter the quantity received for at least one item.");
  if (input.receivedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new AppError("Invalid received date.");

  let poLines = new Map<string, { product_id: string; remaining: number }>();
  if (input.purchaseOrderId) {
    const po = await lockPo(db, ctx, input.purchaseOrderId);
    if (po.status === "cancelled" || po.status === "received") throw new AppError("This purchase order is closed; goods cannot be received against it.");
    if (po.status === "draft") throw new AppError("Mark the purchase order as sent before receiving goods against it.");
    if (po.supplier_id !== input.supplierId) throw new AppError("Supplier does not match the purchase order.");
    const rows = await db.query<{ id: string; product_id: string; remaining: string }>(
      "SELECT id, product_id, greatest(quantity_base - received_qty_base, 0) AS remaining FROM purchase_order_lines WHERE purchase_order_id = $1",
      [input.purchaseOrderId],
    );
    poLines = new Map(rows.map((r) => [r.id, { product_id: r.product_id, remaining: Number(r.remaining) }]));
  }

  const products = await db.query<{ id: string; base_unit: string }>("SELECT id, base_unit FROM products WHERE business_id = $1 AND id = ANY($2::uuid[])", [ctx.businessId, lines.map((l) => l.productId)]);
  const units = await db.query<{ product_id: string; unit_code: string; factor_to_base: string }>("SELECT product_id, unit_code, factor_to_base FROM product_units WHERE business_id = $1 AND product_id = ANY($2::uuid[])", [ctx.businessId, lines.map((l) => l.productId)]);
  const pmap = new Map(products.map((p) => [p.id, p]));

  let receiptNumber: string;
  let receiptId: string;
  try {
    receiptNumber = await nextNumber(db, ctx.businessId, "grn", "GRN");
    receiptId = (
      await db.one<{ id: string }>(
        `INSERT INTO goods_receipts (business_id, receipt_number, purchase_order_id, supplier_id, invoice_document_id, supplier_invoice_ref, received_on, notes, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date, current_date),$8,$9,$10) RETURNING id`,
        [ctx.businessId, receiptNumber, input.purchaseOrderId ?? null, input.supplierId, input.invoiceDocumentId ?? null, input.supplierInvoiceRef?.slice(0, 80) ?? null, input.receivedOn ?? null, input.notes?.slice(0, 1000) ?? null, input.idempotencyKey, ctx.userId],
      )
    ).id;
  } catch (err) {
    fromPgError(err, "This receipt was already recorded.");
  }

  for (const l of lines) {
    const p = pmap.get(l.productId);
    if (!p) throw new AppError("A product on this receipt was not found.");
    if (l.poLineId) {
      const pl = poLines.get(l.poLineId);
      if (!pl || pl.product_id !== l.productId) throw new AppError("A receipt line does not belong to this purchase order.");
    }
    const conv = toBaseQuantity(
      l.quantity,
      l.unit ?? p.base_unit,
      p.base_unit,
      units.filter((u) => u.product_id === p.id).map((u) => ({ unitCode: u.unit_code, factorToBase: Number(u.factor_to_base) })),
    );
    if (!conv.ok) throw new AppError(conv.reason);
    await db.query(
      `INSERT INTO goods_receipt_lines (business_id, goods_receipt_id, purchase_order_line_id, product_id, quantity, unit, unit_factor, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.businessId, receiptId!, l.poLineId ?? null, l.productId, l.quantity, normalizeUnit(l.unit ?? p.base_unit), conv.factor, l.unitCost ?? null],
    );
  }
  await audit(db, ctx, "receipt.drafted", "goods_receipt", receiptId!, { receiptNumber: receiptNumber!, lines: lines.length });
  return { id: receiptId!, existing: false };
}

/**
 * Confirms a receipt: posts one ledger movement per line (idempotency key per line), updates received
 * quantities on the PO and its status. Confirming twice is a no-op.
 */
export async function confirmReceipt(db: Tx, ctx: Ctx, receiptId: string): Promise<{ alreadyConfirmed: boolean; movements: number; overReceived: string[] }> {
  uuid.parse(receiptId);
  const r = await db.maybeOne<{ id: string; status: string; purchase_order_id: string | null; received_on: string; receipt_number: string; invoice_document_id: string | null }>(
    "SELECT id, status, purchase_order_id, received_on, receipt_number, invoice_document_id FROM goods_receipts WHERE business_id = $1 AND id = $2 FOR UPDATE",
    [ctx.businessId, receiptId],
  );
  if (!r) throw new NotFoundError("Goods receipt");
  if (r.status === "confirmed") return { alreadyConfirmed: true, movements: 0, overReceived: [] };
  if (r.status === "cancelled") throw new AppError("This receipt was cancelled.");
  if (r.purchase_order_id) await lockPo(db, ctx, r.purchase_order_id);

  const lines = await db.query<{ id: string; product_id: string; quantity_base: string; unit_cost: string | null; unit_factor: string; purchase_order_line_id: string | null; sku: string }>(
    `SELECT g.id, g.product_id, g.quantity_base, g.unit_cost, g.unit_factor, g.purchase_order_line_id, p.sku
       FROM goods_receipt_lines g JOIN products p ON p.id = g.product_id WHERE g.goods_receipt_id = $1`,
    [receiptId],
  );
  const over: string[] = [];
  for (const l of lines) {
    const costPerBase = l.unit_cost === null ? null : Number(l.unit_cost) / Number(l.unit_factor || 1);
    await db.query(
      `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, unit_cost, occurred_at, source_type, source_id, idempotency_key, note, created_by)
       VALUES ($1,$2,'receipt',$3,$4, CASE WHEN $5::date = current_date THEN now() ELSE $5::date + time '12:00' END,'goods_receipt',$6,$7,$8,$9)`,
      [ctx.businessId, l.product_id, l.quantity_base, costPerBase, r.received_on, receiptId, `receipt:${l.id}`, `Goods received ${r.receipt_number}`, ctx.userId],
    );
    if (l.purchase_order_line_id) {
      const upd = await db.one<{ over: boolean }>(
        `UPDATE purchase_order_lines SET received_qty_base = received_qty_base + $2 WHERE id = $1
         RETURNING received_qty_base > quantity_base AS over`,
        [l.purchase_order_line_id, l.quantity_base],
      );
      if (upd.over) over.push(l.sku);
    }
  }
  if (r.purchase_order_id) {
    const st = await db.one<{ outstanding: number; any_received: boolean }>(
      `SELECT count(*) FILTER (WHERE received_qty_base < quantity_base)::int AS outstanding, bool_or(received_qty_base > 0) AS any_received
         FROM purchase_order_lines WHERE purchase_order_id = $1`,
      [r.purchase_order_id],
    );
    await db.query("UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1", [r.purchase_order_id, st.outstanding === 0 ? "received" : st.any_received ? "partially_received" : "sent"]);
  }
  await db.query("UPDATE goods_receipts SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [receiptId, ctx.userId]);
  if (r.invoice_document_id) await db.query("UPDATE invoice_documents SET status = 'confirmed', goods_receipt_id = $2, updated_at = now() WHERE id = $1", [r.invoice_document_id, receiptId]);
  await audit(db, ctx, "receipt.confirmed", "goods_receipt", receiptId, { receiptNumber: r.receipt_number, lines: lines.length, overReceived: over });
  return { alreadyConfirmed: false, movements: lines.length, overReceived: over };
}

export async function getReceipt(db: Tx, businessId: string, id: string) {
  uuid.parse(id);
  const r = await db.maybeOne<{ id: string; receipt_number: string; status: string; received_on: string; supplier_id: string; supplier_name: string; purchase_order_id: string | null; po_number: string | null; supplier_invoice_ref: string | null; invoice_document_id: string | null; notes: string | null; confirmed_at: Date | null }>(
    `SELECT r.id, r.receipt_number, r.status, r.received_on, r.supplier_id, s.name AS supplier_name, r.purchase_order_id, o.po_number, r.supplier_invoice_ref, r.invoice_document_id, r.notes, r.confirmed_at
       FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN purchase_orders o ON o.id = r.purchase_order_id
      WHERE r.business_id = $1 AND r.id = $2`,
    [businessId, id],
  );
  if (!r) throw new NotFoundError("Goods receipt");
  const lines = await db.query<{ id: string; sku: string; name: string; quantity: string; unit: string; quantity_base: string; base_unit: string; unit_cost: string | null }>(
    `SELECT g.id, p.sku, p.name, g.quantity, g.unit, g.quantity_base, p.base_unit, g.unit_cost FROM goods_receipt_lines g JOIN products p ON p.id = g.product_id WHERE g.goods_receipt_id = $1 ORDER BY p.name`,
    [id],
  );
  return { receipt: r, lines };
}

export async function cancelDraftReceipt(db: Tx, ctx: Ctx, id: string) {
  const rows = await db.query("UPDATE goods_receipts SET status = 'cancelled' WHERE business_id = $1 AND id = $2 AND status = 'draft' RETURNING id", [ctx.businessId, id]);
  if (!rows.length) throw new AppError("Only draft receipts can be cancelled.");
  await audit(db, ctx, "receipt.cancelled", "goods_receipt", id);
}

/** Supplier-wise purchase totals from imported history (for the assistant and supplier analysis). */
export async function supplierSpend(db: Tx, businessId: string, days = 90) {
  return db.query<{ supplier_id: string | null; supplier_name: string | null; value: string; lines: number; products: number }>(
    `SELECT h.supplier_id, s.name AS supplier_name, coalesce(sum(h.line_total), sum(h.quantity * h.unit_cost)) AS value, count(*)::int AS lines, count(DISTINCT h.product_id)::int AS products
       FROM purchase_history_lines h LEFT JOIN suppliers s ON s.id = h.supplier_id
      WHERE h.business_id = $1 AND h.purchased_on >= (SELECT max(purchased_on) FROM purchase_history_lines WHERE business_id = $1) - $2::int
      GROUP BY 1, 2 ORDER BY 3 DESC NULLS LAST`,
    [businessId, days],
  );
}
