import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { toCsv } from "@/lib/domain/imports/values";
import { normalizeUnit } from "@/lib/domain/units";
import { AppError, fromPgError, NotFoundError } from "@/lib/errors";
import { assertProductCapacity, getEntitlements } from "./entitlements";

type Ctx = { userId: string; businessId: string };

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optNum = (label: string, opts: { int?: boolean; min?: number; max?: number } = {}) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const n = Number(String(v).replace(/,/g, ""));
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a number` });
        return z.NEVER;
      }
      if (opts.int && !Number.isInteger(n)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number` });
        return z.NEVER;
      }
      if (n < (opts.min ?? 0)) {
        ctx.addIssue({ code: "custom", message: `${label} cannot be negative` });
        return z.NEVER;
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: "custom", message: `${label} must be ${opts.max} or less` });
        return z.NEVER;
      }
      return n;
    });

export const productSchema = z
  .object({
    sku: z.string().trim().min(1, "SKU is required").max(80),
    name: z.string().trim().min(1, "Name is required").max(300),
    barcode: optText(64),
    description: optText(2000),
    category: optText(120),
    brand: optText(120),
    mpn: optText(120),
    base_unit: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .transform((v) => normalizeUnit(v) ?? "pcs"),
    purchase_cost: optNum("Purchase cost"),
    selling_price: optNum("Selling price"),
    preferred_supplier_id: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^[0-9a-f-]{36}$/.test(v), "Invalid supplier"),
    min_stock: optNum("Minimum stock"),
    max_stock: optNum("Maximum stock"),
    safety_stock: optNum("Safety stock"),
    lead_time_days: optNum("Lead time", { int: true, max: 365 }),
    storage_location: optText(120),
    reserved_qty: optNum("Reserved quantity"),
  })
  .refine((p) => p.max_stock === null || p.min_stock === null || p.max_stock >= p.min_stock, { message: "Maximum stock must be at least the minimum stock", path: ["max_stock"] });

export type ProductInput = z.input<typeof productSchema>;

export type ProductListParams = {
  q?: string;
  category?: string;
  supplierId?: string;
  status?: "active" | "inactive" | "all";
  stock?: "all" | "out" | "in";
  sort?: "name" | "sku" | "on_hand" | "value" | "updated";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const SORTS: Record<NonNullable<ProductListParams["sort"]>, string> = {
  name: "p.name",
  sku: "lower(p.sku)",
  on_hand: "p.on_hand",
  value: "(greatest(p.on_hand,0) * coalesce(p.purchase_cost,0))",
  updated: "p.updated_at",
};

export async function listProducts(db: Tx, businessId: string, params: ProductListParams) {
  // Integers only: these values are written into LIMIT/OFFSET.
  const pageSize = Math.min(200, Math.max(10, Math.floor(Number(params.pageSize) || 50)));
  const page = Math.min(100_000, Math.max(1, Math.floor(Number(params.page) || 1)));
  const where: string[] = ["p.business_id = $1"];
  const args: unknown[] = [businessId];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("?", `$${args.length}`));
  };
  if (params.q?.trim()) {
    const q = params.q.trim().slice(0, 100);
    args.push(`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const i = args.length;
    where.push(
      `(p.name ILIKE $${i} OR p.sku ILIKE $${i} OR p.barcode ILIKE $${i} OR p.mpn ILIKE $${i} OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id = p.id AND a.value ILIKE $${i}))`,
    );
  }
  if (params.category) add("p.category = ?", params.category);
  if (params.supplierId) add("p.preferred_supplier_id = ?", params.supplierId);
  if ((params.status ?? "active") !== "all") add("p.active = ?", (params.status ?? "active") === "active");
  if (params.stock === "out") where.push("p.on_hand <= 0");
  if (params.stock === "in") where.push("p.on_hand > 0");
  const order = `${SORTS[params.sort ?? "name"] ?? SORTS.name} ${params.dir === "desc" ? "DESC" : "ASC"}, p.id`;
  const rows = await db.query<{
    id: string; sku: string; name: string; category: string | null; brand: string | null; base_unit: string; on_hand: string;
    purchase_cost: string | null; selling_price: string | null; min_stock: string | null; active: boolean; supplier_name: string | null; total: number;
  }>(
    `SELECT p.id, p.sku, p.name, p.category, p.brand, p.base_unit, p.on_hand, p.purchase_cost, p.selling_price, p.min_stock, p.active,
            s.name AS supplier_name, count(*) OVER ()::int AS total
       FROM products p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  return { rows, total: rows[0]?.total ?? 0, page, pageSize };
}

export async function productFacets(db: Tx, businessId: string) {
  const [categories, suppliers] = [
    await db.query<{ category: string }>("SELECT DISTINCT category FROM products WHERE business_id = $1 AND category IS NOT NULL ORDER BY 1", [businessId]),
    await db.query<{ id: string; name: string }>("SELECT id, name FROM suppliers WHERE business_id = $1 AND active ORDER BY name", [businessId]),
  ];
  return { categories: categories.map((c) => c.category), suppliers };
}

export async function getProduct(db: Tx, businessId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundError("Product");
  const product = await db.maybeOne<Record<string, unknown> & { id: string; sku: string; name: string; base_unit: string; on_hand: string; active: boolean; preferred_supplier_id: string | null }>(
    `SELECT p.*, s.name AS supplier_name FROM products p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id WHERE p.business_id = $1 AND p.id = $2`,
    [businessId, id],
  );
  if (!product) throw new NotFoundError("Product");
  const units = await db.query<{ id: string; unit_code: string; factor_to_base: string }>("SELECT id, unit_code, factor_to_base FROM product_units WHERE product_id = $1 ORDER BY unit_code", [id]);
  const aliases = await db.query<{ id: string; alias_type: string; value: string; supplier_name: string | null }>(
    "SELECT a.id, a.alias_type, a.value, s.name AS supplier_name FROM product_aliases a LEFT JOIN suppliers s ON s.id = a.supplier_id WHERE a.product_id = $1 ORDER BY a.created_at",
    [id],
  );
  const supplierProducts = await db.query<{ id: string; supplier_id: string; supplier_name: string; supplier_sku: string | null; purchase_price: string | null; moq: string | null; pack_size: string | null; lead_time_days: number | null; price_updated_at: Date | null }>(
    `SELECT sp.id, sp.supplier_id, s.name AS supplier_name, sp.supplier_sku, sp.purchase_price, sp.moq, sp.pack_size, sp.lead_time_days, sp.price_updated_at
       FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id WHERE sp.product_id = $1 ORDER BY sp.purchase_price NULLS LAST`,
    [id],
  );
  const movements = await db.query<{ id: number; movement_type: string; quantity: string; occurred_at: Date; source_type: string; note: string | null }>(
    "SELECT id, movement_type, quantity, occurred_at, source_type, note FROM inventory_movements WHERE business_id = $1 AND product_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 30",
    [businessId, id],
  );
  const purchases = await db.query<{ purchased_on: string; supplier_name: string | null; quantity: string; unit_cost: string | null; bill_ref: string | null }>(
    `SELECT h.purchased_on, s.name AS supplier_name, h.quantity, h.unit_cost, h.bill_ref FROM purchase_history_lines h LEFT JOIN suppliers s ON s.id = h.supplier_id
      WHERE h.business_id = $1 AND h.product_id = $2 ORDER BY h.purchased_on DESC LIMIT 15`,
    [businessId, id],
  );
  const weekly = await db.query<{ week: string; qty: string }>(
    `SELECT to_char(date_trunc('week', sold_on), 'YYYY-MM-DD') AS week, sum(quantity) AS qty FROM sales_lines
      WHERE business_id = $1 AND product_id = $2 AND sold_on >= (SELECT max(sold_on) FROM sales_lines WHERE business_id = $1) - 181
      GROUP BY 1 ORDER BY 1`,
    [businessId, id],
  );
  return { product, units, aliases, supplierProducts, movements, purchases, weekly };
}

async function audit(db: Tx, ctx: Ctx, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,'product',$4,$5)", [
    ctx.businessId, ctx.userId, action, entityId, JSON.stringify(metadata),
  ]);
}

export async function createProduct(db: Tx, ctx: Ctx, input: ProductInput & { opening_stock?: string | number | null }) {
  const p = productSchema.parse(input);
  const ent = await getEntitlements(db, ctx.businessId);
  await assertProductCapacity(db, ctx.businessId, ent, 1);
  let id: string;
  try {
    id = (
      await db.one<{ id: string }>(
        `INSERT INTO products (business_id, sku, name, barcode, description, category, brand, mpn, base_unit, purchase_cost, selling_price,
                               preferred_supplier_id, min_stock, max_stock, safety_stock, lead_time_days, storage_location, reserved_qty, introduced_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,coalesce($18,0), current_date) RETURNING id`,
        [ctx.businessId, p.sku, p.name, p.barcode, p.description, p.category, p.brand, p.mpn, p.base_unit, p.purchase_cost, p.selling_price,
          p.preferred_supplier_id, p.min_stock, p.max_stock, p.safety_stock, p.lead_time_days, p.storage_location, p.reserved_qty],
      )
    ).id;
  } catch (err) {
    fromPgError(err, "A product with this SKU or barcode already exists.");
  }
  const opening = input.opening_stock === undefined || input.opening_stock === null || String(input.opening_stock).trim() === "" ? 0 : Number(input.opening_stock);
  if (!Number.isFinite(opening)) throw new AppError("Opening stock must be a number.");
  if (opening !== 0) {
    await db.query(
      `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, unit_cost, source_type, idempotency_key, note, created_by)
       VALUES ($1,$2,'opening',$3,$4,'manual',$5,'Opening stock entered with the product',$6)`,
      [ctx.businessId, id!, opening, p.purchase_cost, `opening:${id!}`, ctx.userId],
    );
  }
  await audit(db, ctx, "product.created", id!, { sku: p.sku });
  return id!;
}

export async function updateProduct(db: Tx, ctx: Ctx, id: string, input: ProductInput) {
  const p = productSchema.parse(input);
  try {
    const rows = await db.query(
      `UPDATE products SET sku=$3, name=$4, barcode=$5, description=$6, category=$7, brand=$8, mpn=$9, base_unit=$10, purchase_cost=$11,
              selling_price=$12, preferred_supplier_id=$13, min_stock=$14, max_stock=$15, safety_stock=$16, lead_time_days=$17,
              storage_location=$18, reserved_qty=coalesce($19,0), updated_at=now()
        WHERE business_id=$1 AND id=$2 RETURNING id`,
      [ctx.businessId, id, p.sku, p.name, p.barcode, p.description, p.category, p.brand, p.mpn, p.base_unit, p.purchase_cost, p.selling_price,
        p.preferred_supplier_id, p.min_stock, p.max_stock, p.safety_stock, p.lead_time_days, p.storage_location, p.reserved_qty],
    );
    if (!rows.length) throw new NotFoundError("Product");
  } catch (err) {
    if (err instanceof AppError) throw err;
    fromPgError(err, "Another product already uses this SKU or barcode.");
  }
  await audit(db, ctx, "product.updated", id, { sku: p.sku });
}

/** Archive keeps all history; nothing is ever deleted from the ledger. */
export async function setProductActive(db: Tx, ctx: Ctx, id: string, active: boolean) {
  const rows = await db.query("UPDATE products SET active = $3, updated_at = now() WHERE business_id = $1 AND id = $2 RETURNING id", [ctx.businessId, id, active]);
  if (!rows.length) throw new NotFoundError("Product");
  await audit(db, ctx, active ? "product.restored" : "product.archived", id);
}

export const adjustmentSchema = z.object({
  counted: z.coerce.number().refine((n) => Number.isFinite(n), "Enter the counted quantity"),
  reason: z.string().trim().min(3, "Give a short reason, e.g. 'physical count' or 'damaged'").max(200),
});

/** Records a physical count for one product: posts the difference as a manual adjustment. */
export async function adjustStock(db: Tx, ctx: Ctx, id: string, input: z.input<typeof adjustmentSchema>) {
  const a = adjustmentSchema.parse(input);
  const p = await db.maybeOne<{ on_hand: string }>("SELECT on_hand FROM products WHERE business_id = $1 AND id = $2 FOR UPDATE", [ctx.businessId, id]);
  if (!p) throw new NotFoundError("Product");
  const delta = Math.round((a.counted - Number(p.on_hand)) * 1000) / 1000;
  if (delta === 0) return { delta: 0 };
  await db.query(
    `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, source_type, idempotency_key, note, created_by)
     VALUES ($1,$2,'manual_adjustment',$3,'manual',$4,$5,$6)`,
    [ctx.businessId, id, delta, `adjust:${randomUUID()}`, a.reason, ctx.userId],
  );
  await audit(db, ctx, "stock.adjusted", id, { from: Number(p.on_hand), to: a.counted, delta, reason: a.reason });
  return { delta };
}

export async function addUnitConversion(db: Tx, ctx: Ctx, productId: string, unitRaw: string, factorRaw: string) {
  const unit = normalizeUnit(unitRaw);
  const factor = Number(factorRaw);
  if (!unit) throw new AppError("Enter a unit, e.g. box.");
  if (!(factor > 0) || factor > 1e6) throw new AppError("Enter how many base units are in one of this unit (a positive number).");
  const p = await db.maybeOne<{ base_unit: string }>("SELECT base_unit FROM products WHERE business_id = $1 AND id = $2", [ctx.businessId, productId]);
  if (!p) throw new NotFoundError("Product");
  if (unit === normalizeUnit(p.base_unit)) throw new AppError("That is already the product's base unit.");
  try {
    await db.query("INSERT INTO product_units (business_id, product_id, unit_code, factor_to_base) VALUES ($1,$2,$3,$4)", [ctx.businessId, productId, unit, factor]);
  } catch (err) {
    fromPgError(err, `A conversion for "${unit}" already exists.`);
  }
  await audit(db, ctx, "product.unit_added", productId, { unit, factor });
}

export async function removeUnitConversion(db: Tx, ctx: Ctx, productId: string, unitId: string) {
  await db.query("DELETE FROM product_units WHERE business_id = $1 AND product_id = $2 AND id = $3", [ctx.businessId, productId, unitId]);
}

export async function addAlias(db: Tx, ctx: Ctx, productId: string, input: { value: string; type: string; supplierId?: string | null }) {
  const value = input.value.trim();
  if (!value || value.length > 120) throw new AppError("Enter the code (up to 120 characters).");
  const type = ["supplier_code", "alias", "old_sku"].includes(input.type) ? input.type : "alias";
  const supplierId = type === "supplier_code" && input.supplierId ? input.supplierId : null;
  if (type === "supplier_code" && !supplierId) throw new AppError("Choose the supplier this code belongs to.");
  const clash = await db.maybeOne<{ sku: string }>("SELECT sku FROM products WHERE business_id = $1 AND lower(sku) = lower($2) AND id <> $3", [ctx.businessId, value, productId]);
  if (clash) throw new AppError(`"${value}" is already the SKU of another product (${clash.sku}).`);
  try {
    await db.query("INSERT INTO product_aliases (business_id, product_id, alias_type, value, supplier_id) VALUES ($1,$2,$3,$4,$5)", [ctx.businessId, productId, type, value, supplierId]);
  } catch (err) {
    fromPgError(err, "This code is already used by another product.");
  }
  if (supplierId) {
    await db.query(
      `INSERT INTO supplier_products (business_id, supplier_id, product_id, supplier_sku) VALUES ($1,$2,$3,$4)
       ON CONFLICT (supplier_id, product_id) DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku`,
      [ctx.businessId, supplierId, productId, value],
    );
  }
}

export async function removeAlias(db: Tx, ctx: Ctx, productId: string, aliasId: string) {
  await db.query("DELETE FROM product_aliases WHERE business_id = $1 AND product_id = $2 AND id = $3", [ctx.businessId, productId, aliasId]);
}

export const supplierProductSchema = z.object({
  supplier_id: z.string().regex(/^[0-9a-f-]{36}$/, "Choose a supplier"),
  supplier_sku: optText(80),
  purchase_price: optNum("Price"),
  moq: optNum("Minimum order"),
  pack_size: optNum("Pack size"),
  lead_time_days: optNum("Lead time", { int: true, max: 365 }),
});

export async function upsertSupplierProduct(db: Tx, ctx: Ctx, productId: string, input: z.input<typeof supplierProductSchema>) {
  const d = supplierProductSchema.parse(input);
  if (d.moq === 0 || d.pack_size === 0) throw new AppError("Minimum order and pack size must be greater than zero.");
  await db.query(
    `INSERT INTO supplier_products (business_id, supplier_id, product_id, supplier_sku, purchase_price, moq, pack_size, lead_time_days, price_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $5::numeric IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (supplier_id, product_id) DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku, purchase_price = EXCLUDED.purchase_price,
       moq = EXCLUDED.moq, pack_size = EXCLUDED.pack_size, lead_time_days = EXCLUDED.lead_time_days,
       price_updated_at = CASE WHEN EXCLUDED.purchase_price IS DISTINCT FROM supplier_products.purchase_price THEN now() ELSE supplier_products.price_updated_at END`,
    [ctx.businessId, d.supplier_id, productId, d.supplier_sku, d.purchase_price, d.moq, d.pack_size, d.lead_time_days],
  );
  await audit(db, ctx, "product.supplier_terms_updated", productId, { supplierId: d.supplier_id });
}

export async function removeSupplierProduct(db: Tx, ctx: Ctx, productId: string, id: string) {
  await db.query("DELETE FROM supplier_products WHERE business_id = $1 AND product_id = $2 AND id = $3", [ctx.businessId, productId, id]);
}

export async function exportProductsCsv(db: Tx, businessId: string): Promise<string> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT p.sku, p.name, p.barcode, p.category, p.brand, p.mpn, p.base_unit, p.on_hand, p.purchase_cost, p.selling_price, p.min_stock, p.max_stock,
            p.safety_stock, p.lead_time_days, p.storage_location, s.name AS supplier, CASE WHEN p.active THEN 'active' ELSE 'inactive' END AS status
       FROM products p LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id WHERE p.business_id = $1 ORDER BY p.name`,
    [businessId],
  );
  const headers = ["SKU", "Name", "Barcode", "Category", "Brand", "MPN", "Unit", "On hand", "Purchase cost", "Selling price", "Min stock", "Max stock", "Safety stock", "Lead time days", "Location", "Supplier", "Status"];
  return toCsv(headers, rows.map((r) => Object.values(r)));
}
