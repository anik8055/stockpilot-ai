import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "@/lib/db";
import { todayIn } from "@/lib/domain/dates";
import { fieldsFor, IMPORT_KINDS, type ImportKind } from "@/lib/domain/imports/fields";
import { applySavedMapping, detectHeaderRow, headerSignature, mappingToHeaderNames, suggestMapping, type Mapping, type MappingSuggestion } from "@/lib/domain/imports/mapping";
import { validateRows, type NormalizedRow, type ProductLookup, type ProductRef, type ValidationSummary } from "@/lib/domain/imports/validate";
import { detectDateOrder, toCsv, type DateOrder } from "@/lib/domain/imports/values";
import { normalizeName } from "@/lib/domain/slow-moving";
import { AppError, NotFoundError } from "@/lib/errors";
import { objectKey, sha256, storage } from "@/lib/storage";
import { assertMonthlyQuota, assertProductCapacity, getEntitlements } from "./entitlements";
import { parseSpreadsheet, type ParsedSheet } from "./spreadsheet";

type Ctx = { userId: string; businessId: string; timezone: string };

export type ImportOptions = {
  sheet?: string;
  headerRow?: number;
  dateOrder?: DateOrder;
  dateOrderAmbiguous?: boolean;
  /** stock_snapshot / products+recordStock: the date the stock figures are "as on". */
  snapshotDate?: string;
  recordStock?: boolean;
  updateCosts?: boolean;
};

export type ImportJob = {
  id: string;
  kind: ImportKind;
  status: "uploaded" | "validated" | "committed" | "failed" | "cancelled";
  original_filename: string;
  file_sha256: string;
  storage_key: string;
  sheet_name: string | null;
  header_row: number | null;
  headers: string[] | null;
  mapping: Mapping | null;
  options: ImportOptions & { sheets?: string[]; suggestion?: MappingSuggestion; savedMappingName?: string | null };
  row_count: number | null;
  valid_count: number | null;
  error_count: number | null;
  warning_count: number | null;
  summary: (ValidationSummary & { committed?: Record<string, number> }) | null;
  error_message: string | null;
  created_at: Date;
  committed_at: Date | null;
};

export const ALLOWED_EXTENSIONS = /\.(csv|txt|xlsx)$/i;

function pickSheet(sheets: ParsedSheet[], name?: string) {
  if (name) {
    const s = sheets.find((x) => x.name === name);
    if (s) return s;
  }
  return sheets.find((s) => s.rows.filter((r) => r.some((c) => String(c).trim())).length >= 2) ?? sheets[0];
}

export async function createImportJob(db: Tx, ctx: Ctx, kind: ImportKind, filename: string, buf: Buffer): Promise<string> {
  if (!IMPORT_KINDS[kind]) throw new AppError("Unknown import type.");
  if (!ALLOWED_EXTENSIONS.test(filename)) throw new AppError("Upload a .csv or .xlsx file.");
  const wb = await parseSpreadsheet(buf);
  const sheet = pickSheet(wb.sheets);
  if (sheet.rows.length < 2) throw new AppError("The file has no data rows.");
  const headerRow = detectHeaderRow(sheet.rows, kind);
  const headers = (sheet.rows[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const suggestion = suggestMapping(headers, kind);

  // Offer a saved mapping when this layout has been imported before
  const saved = await db.maybeOne<{ name: string; mapping: Record<string, string | null> }>(
    "SELECT name, mapping FROM import_mappings WHERE business_id = $1 AND kind = $2 AND header_signature = $3 ORDER BY created_at DESC LIMIT 1",
    [ctx.businessId, kind, headerSignature(headers)],
  );
  const mapping = saved ? { ...suggestion.mapping, ...applySavedMapping(saved.mapping, headers) } : suggestion.mapping;

  const options: ImportJob["options"] = {
    sheet: sheet.name,
    headerRow,
    sheets: wb.sheets.map((s) => s.name),
    suggestion,
    savedMappingName: saved?.name ?? null,
    snapshotDate: todayIn(ctx.timezone),
  };
  if (mapping.date !== undefined && mapping.date !== null) {
    const samples = sheet.rows.slice(headerRow + 1, headerRow + 400).map((r) => r[mapping.date as number]);
    const det = detectDateOrder(samples);
    options.dateOrder = det.order;
    options.dateOrderAmbiguous = det.ambiguous;
  }

  const id = randomUUID();
  const key = objectKey(ctx.businessId, "imports", id);
  await storage().put(key, buf, "application/octet-stream");
  await db.query(
    `INSERT INTO import_jobs (id, business_id, kind, status, original_filename, file_sha256, storage_key, sheet_name, header_row, headers, mapping, options, row_count, created_by)
     VALUES ($1,$2,$3,'uploaded',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, ctx.businessId, kind, filename.slice(0, 200), sha256(buf), key, sheet.name, headerRow, JSON.stringify(headers), JSON.stringify(mapping), JSON.stringify(options), Math.max(0, sheet.rows.length - headerRow - 1), ctx.userId],
  );
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'import.uploaded','import',$3,$4)", [
    ctx.businessId, ctx.userId, id, JSON.stringify({ kind, filename: filename.slice(0, 200) }),
  ]);
  return id;
}

export async function getImportJob(db: Tx, businessId: string, id: string): Promise<ImportJob> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundError("Import");
  const job = await db.maybeOne<ImportJob>("SELECT * FROM import_jobs WHERE business_id = $1 AND id = $2", [businessId, id]);
  if (!job) throw new NotFoundError("Import");
  return job;
}

async function loadSheet(job: ImportJob, sheetName?: string) {
  const buf = await storage().get(job.storage_key);
  const wb = await parseSpreadsheet(buf);
  return pickSheet(wb.sheets, sheetName ?? job.sheet_name ?? undefined);
}

/** Raw preview of the first rows so the user can see what each column contains. */
export async function previewRows(job: ImportJob, limit = 8) {
  const sheet = await loadSheet(job);
  const hr = job.header_row ?? 0;
  return sheet.rows.slice(hr + 1).filter((r) => r.some((c) => String(c).trim())).slice(0, limit);
}

/** Switching sheet or header row re-detects headers and the suggested mapping. */
export async function changeSheet(db: Tx, ctx: Ctx, jobId: string, sheetName: string, headerRow?: number) {
  const job = await getImportJob(db, ctx.businessId, jobId);
  if (job.status === "committed") throw new AppError("This import has already been completed.");
  const sheet = await loadSheet(job, sheetName);
  const hr = headerRow !== undefined && headerRow >= 0 && headerRow < Math.min(sheet.rows.length, 50) ? headerRow : detectHeaderRow(sheet.rows, job.kind);
  const headers = (sheet.rows[hr] ?? []).map((h) => String(h ?? "").trim());
  const suggestion = suggestMapping(headers, job.kind);
  const options = { ...job.options, sheet: sheet.name, headerRow: hr, suggestion };
  await db.query(
    "UPDATE import_jobs SET sheet_name=$3, header_row=$4, headers=$5, mapping=$6, options=$7, status='uploaded', row_count=$8 WHERE business_id=$1 AND id=$2",
    [ctx.businessId, jobId, sheet.name, hr, JSON.stringify(headers), JSON.stringify(suggestion.mapping), JSON.stringify(options), Math.max(0, sheet.rows.length - hr - 1)],
  );
}

// ------------------------------------------------------------------ product lookup for validation and commit

async function buildLookup(db: Tx, businessId: string): Promise<ProductLookup & { refs: Map<string, ProductRef> }> {
  const products = await db.query<{ id: string; sku: string; name: string; base_unit: string; barcode: string | null }>(
    "SELECT id, sku, name, base_unit, barcode FROM products WHERE business_id = $1",
    [businessId],
  );
  const units = await db.query<{ product_id: string; unit_code: string; factor_to_base: string }>("SELECT product_id, unit_code, factor_to_base FROM product_units WHERE business_id = $1", [businessId]);
  const aliases = await db.query<{ product_id: string; value: string }>("SELECT product_id, value FROM product_aliases WHERE business_id = $1", [businessId]);
  const refs = new Map<string, ProductRef>();
  for (const p of products) refs.set(p.id, { id: p.id, sku: p.sku, name: p.name, baseUnit: p.base_unit, conversions: [] });
  for (const u of units) refs.get(u.product_id)?.conversions.push({ unitCode: u.unit_code, factorToBase: Number(u.factor_to_base) });
  const byCode = new Map<string, ProductRef>();
  for (const p of products) byCode.set(p.sku.toLowerCase(), refs.get(p.id)!);
  for (const a of aliases) if (!byCode.has(a.value.toLowerCase())) byCode.set(a.value.toLowerCase(), refs.get(a.product_id)!);
  for (const p of products) if (p.barcode && !byCode.has(p.barcode.toLowerCase())) byCode.set(p.barcode.toLowerCase(), refs.get(p.id)!);
  const byName = new Map<string, ProductRef | "ambiguous">();
  for (const p of products) {
    const k = normalizeName(p.name);
    byName.set(k, byName.has(k) ? "ambiguous" : refs.get(p.id)!);
  }
  return {
    refs,
    byCode: (c) => byCode.get(c.trim().toLowerCase()) ?? null,
    byName: (n) => byName.get(normalizeName(n)) ?? null,
  };
}

export type ValidationResult = { summary: ValidationSummary; rows: NormalizedRow[]; job: ImportJob };

async function runValidation(db: Tx, ctx: Ctx, job: ImportJob, mapping: Mapping, options: ImportOptions) {
  const sheet = await loadSheet(job, options.sheet);
  const hr = options.headerRow ?? job.header_row ?? 0;
  const lookup = await buildLookup(db, ctx.businessId);
  const { rows, summary } = validateRows(job.kind, sheet.rows.slice(hr + 1), hr + 2, mapping, lookup, {
    dateOrder: options.dateOrder,
    recordStock: options.recordStock,
    today: todayIn(ctx.timezone),
  });
  return { rows, summary };
}

export async function validateImport(db: Tx, ctx: Ctx, jobId: string, mapping: Mapping, opts: ImportOptions, saveAs?: string | null): Promise<ValidationSummary> {
  const job = await getImportJob(db, ctx.businessId, jobId);
  if (job.status === "committed") throw new AppError("This import has already been completed.");
  const headers = job.headers ?? [];
  const fields = fieldsFor(job.kind);
  // Mapping must reference real columns, each column at most once.
  const clean: Mapping = {};
  const used = new Map<number, string>();
  for (const f of fields) {
    const v = mapping[f.key];
    if (v === null || v === undefined || Number.isNaN(v)) {
      clean[f.key] = null;
      continue;
    }
    if (v < 0 || v >= headers.length) throw new AppError(`Column for "${f.label}" is not in the file.`);
    if (used.has(v)) throw new AppError(`Column "${headers[v]}" is mapped to both "${used.get(v)}" and "${f.label}". Each column can only be used once.`);
    used.set(v, f.label);
    clean[f.key] = v;
  }
  const missing = fields.filter((f) => f.required && clean[f.key] === null && !(f.key === "sku" && job.kind !== "products" && clean.name !== null));
  if (missing.length) throw new AppError(`Choose a column for: ${missing.map((m) => m.label).join(", ")}.`);
  if ((job.kind === "stock_snapshot" || opts.recordStock) && (!opts.snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(opts.snapshotDate))) {
    throw new AppError("Choose the date the stock quantities are as on.");
  }
  if (opts.snapshotDate && opts.snapshotDate > todayIn(ctx.timezone)) throw new AppError("The stock date cannot be in the future.");

  const options = { ...job.options, ...opts };
  const { rows, summary } = await runValidation(db, ctx, job, clean, options);

  await db.query("DELETE FROM import_row_errors WHERE business_id = $1 AND import_job_id = $2", [ctx.businessId, jobId]);
  const issues = rows.flatMap((r) => r.issues.map((i) => ({ row: r.rowNumber, ...i })));
  const capped = issues.slice(0, 5000);
  if (capped.length) {
    await db.query(
      `INSERT INTO import_row_errors (business_id, import_job_id, row_number, field, severity, code, message, raw_value)
       SELECT $1, $2, r, f, s, c, m, v FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS t(r, f, s, c, m, v)`,
      [ctx.businessId, jobId, capped.map((i) => i.row), capped.map((i) => i.field ?? null), capped.map((i) => i.severity), capped.map((i) => i.code), capped.map((i) => i.message.slice(0, 500)), capped.map((i) => i.rawValue?.slice(0, 200) ?? null)],
    );
  }
  await db.query(
    `UPDATE import_jobs SET status='validated', mapping=$3, options=$4, row_count=$5, valid_count=$6, error_count=$7, warning_count=$8, summary=$9, validated_at=now(), sheet_name=$10, header_row=$11
      WHERE business_id=$1 AND id=$2`,
    [ctx.businessId, jobId, JSON.stringify(clean), JSON.stringify(options), summary.totalRows, summary.valid, summary.errors, summary.warnings, JSON.stringify(summary), options.sheet ?? job.sheet_name, options.headerRow ?? job.header_row],
  );
  if (saveAs && saveAs.trim()) {
    await db.query(
      `INSERT INTO import_mappings (business_id, kind, name, mapping, header_signature, created_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (business_id, kind, name) DO UPDATE SET mapping = EXCLUDED.mapping, header_signature = EXCLUDED.header_signature`,
      [ctx.businessId, job.kind, saveAs.trim().slice(0, 80), JSON.stringify(mappingToHeaderNames(clean, headers)), headerSignature(headers), ctx.userId],
    );
  }
  return summary;
}

/** Normalised valid rows for the preview table (re-validated so the preview always matches what will be written). */
export async function normalizedPreview(db: Tx, ctx: Ctx, job: ImportJob, limit = 25) {
  if (!job.mapping) return [];
  const { rows } = await runValidation(db, ctx, job, job.mapping, job.options);
  return rows.filter((r) => r.status === "valid").slice(0, limit);
}

export async function previousImportOfSameFile(db: Tx, businessId: string, job: ImportJob) {
  return db.maybeOne<{ id: string; committed_at: Date; kind: string }>(
    "SELECT id, committed_at, kind FROM import_jobs WHERE business_id = $1 AND file_sha256 = $2 AND status = 'committed' AND id <> $3 ORDER BY committed_at DESC LIMIT 1",
    [businessId, job.file_sha256, job.id],
  );
}

// ------------------------------------------------------------------ commit

export async function commitImport(db: Tx, ctx: Ctx, jobId: string): Promise<Record<string, number>> {
  // Lock the job row: a double-click or retry cannot commit twice.
  const locked = await db.maybeOne<{ status: string }>("SELECT status FROM import_jobs WHERE business_id = $1 AND id = $2 FOR UPDATE", [ctx.businessId, jobId]);
  if (!locked) throw new NotFoundError("Import");
  if (locked.status === "committed") throw new AppError("This import has already been completed.", 409, "already_committed");
  if (locked.status !== "validated") throw new AppError("Check the file before importing.");
  const job = await getImportJob(db, ctx.businessId, jobId);
  const ent = await getEntitlements(db, ctx.businessId);
  await assertMonthlyQuota(db, ctx.businessId, ent, "imports");

  const { rows } = await runValidation(db, ctx, job, job.mapping!, job.options);
  const valid = rows.filter((r) => r.status === "valid");
  if (valid.length === 0) throw new AppError("There are no valid rows to import. Fix the errors in your file and upload it again.");

  let result: Record<string, number>;
  switch (job.kind) {
    case "products":
      result = await commitProducts(db, ctx, job, valid, ent);
      break;
    case "stock_snapshot":
      result = await commitSnapshot(db, ctx, job, valid.map((r) => ({ productId: r.record._productId as string, qty: r.record._baseQty as number, unitCost: r.record.unit_cost as number | null, factor: (r.record._unitFactor as number) ?? 1 })), !!job.mapping?.unit_cost || job.options.updateCosts === true);
      break;
    case "sales":
      result = await commitSales(db, ctx, job, valid);
      break;
    case "purchases":
      result = await commitPurchases(db, ctx, job, valid);
      break;
    case "suppliers":
      result = await commitSuppliers(db, ctx, valid);
      break;
  }
  const summary = { ...(job.summary ?? {}), committed: result };
  await db.query("UPDATE import_jobs SET status='committed', committed_at=now(), summary=$3 WHERE business_id=$1 AND id=$2", [ctx.businessId, jobId, JSON.stringify(summary)]);
  await db.query("INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'import.committed','import',$3,$4)", [
    ctx.businessId, ctx.userId, jobId, JSON.stringify({ kind: job.kind, ...result }),
  ]);
  return result;
}

async function findOrCreateSupplier(db: Tx, businessId: string, name: string, cache: Map<string, string>): Promise<string> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const row = await db.one<{ id: string }>(
    `INSERT INTO suppliers (business_id, name) VALUES ($1, $2)
     ON CONFLICT (business_id, lower(name)) DO UPDATE SET updated_at = suppliers.updated_at RETURNING id`,
    [businessId, name.trim().slice(0, 200)],
  );
  cache.set(key, row.id);
  return row.id;
}

const PRODUCT_COLUMNS = ["name", "barcode", "description", "category", "brand", "mpn", "base_unit", "purchase_cost", "selling_price", "min_stock", "max_stock", "safety_stock", "lead_time_days", "storage_location"] as const;

async function commitProducts(db: Tx, ctx: Ctx, job: ImportJob, rows: NormalizedRow[], ent: Awaited<ReturnType<typeof getEntitlements>>) {
  const creates = rows.filter((r) => !r.record._existing).length;
  await assertProductCapacity(db, ctx.businessId, ent, creates);
  const mapped = new Set(Object.entries(job.mapping ?? {}).filter(([, v]) => v !== null).map(([k]) => k));
  const suppliers = new Map<string, string>();
  let created = 0;
  let updated = 0;
  const stockRows: { productId: string; qty: number; unitCost: number | null; factor: number }[] = [];
  for (const r of rows) {
    const rec = r.record;
    // Only columns present in the file are written, and empty cells never blank out existing values.
    const set: Record<string, unknown> = {};
    for (const c of PRODUCT_COLUMNS) if (mapped.has(c) && rec[c] !== null && rec[c] !== undefined) set[c] = rec[c];
    let supplierId: string | null = null;
    if (mapped.has("supplier_name") && rec.supplier_name) supplierId = await findOrCreateSupplier(db, ctx.businessId, rec.supplier_name as string, suppliers);
    let productId: string;
    if (rec._existing) {
      productId = rec._existing as string;
      const cols = Object.keys(set);
      if (supplierId) cols.push("preferred_supplier_id");
      if (cols.length) {
        const values = cols.map((c) => (c === "preferred_supplier_id" ? supplierId : set[c]));
        await db.query(
          `UPDATE products SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(", ")}, updated_at = now() WHERE business_id = $1 AND id = $2`,
          [ctx.businessId, productId, ...values],
        );
      }
      updated++;
    } else {
      const row = await db.one<{ id: string }>(
        `INSERT INTO products (business_id, sku, name, barcode, description, category, brand, mpn, base_unit, purchase_cost, selling_price,
                               min_stock, max_stock, safety_stock, lead_time_days, storage_location, preferred_supplier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'pcs'),$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (business_id, lower(sku)) DO NOTHING RETURNING id`,
        [ctx.businessId, rec.sku, set.name ?? rec.sku, set.barcode ?? null, set.description ?? null, set.category ?? null, set.brand ?? null, set.mpn ?? null, set.base_unit ?? null,
          set.purchase_cost ?? null, set.selling_price ?? null, set.min_stock ?? null, set.max_stock ?? null, set.safety_stock ?? null, set.lead_time_days ?? null, set.storage_location ?? null, supplierId],
      );
      productId = row.id;
      created++;
    }
    if (supplierId) {
      await db.query(
        `INSERT INTO supplier_products (business_id, supplier_id, product_id, supplier_sku, purchase_price, price_updated_at)
         VALUES ($1,$2,$3,$4,$5, CASE WHEN $5::numeric IS NULL THEN NULL ELSE now() END)
         ON CONFLICT (supplier_id, product_id) DO UPDATE SET supplier_sku = coalesce(EXCLUDED.supplier_sku, supplier_products.supplier_sku),
           purchase_price = coalesce(EXCLUDED.purchase_price, supplier_products.purchase_price)`,
        [ctx.businessId, supplierId, productId, (rec.supplier_sku as string) ?? null, (rec.purchase_cost as number) ?? null],
      );
      if (rec.supplier_sku) {
        await db.query(
          `INSERT INTO product_aliases (business_id, product_id, alias_type, value, supplier_id) VALUES ($1,$2,'supplier_code',$3,$4)
           ON CONFLICT DO NOTHING`,
          [ctx.businessId, productId, rec.supplier_sku, supplierId],
        );
      }
    }
    if (job.options.recordStock && typeof rec.quantity === "number") stockRows.push({ productId, qty: rec.quantity as number, unitCost: null, factor: 1 });
  }
  let stock: Record<string, number> = {};
  if (stockRows.length) stock = await commitSnapshot(db, ctx, job, stockRows, false);
  return { created, updated, suppliersLinked: suppliers.size, ...stock };
}

/**
 * Stock count: for each listed product, post (counted − ledger balance as at the snapshot time).
 * Re-importing the same counts posts zero deltas, so it is idempotent. Products not in the file are untouched.
 */
async function commitSnapshot(db: Tx, ctx: Ctx, job: ImportJob, rows: { productId: string; qty: number; unitCost: number | null; factor: number }[], updateCosts: boolean) {
  const date = job.options.snapshotDate ?? todayIn(ctx.timezone);
  const snap = await db.one<{ id: string; snapshot_at: Date }>(
    `INSERT INTO stock_snapshots (business_id, import_job_id, snapshot_at, created_by, line_count)
     VALUES ($1, $2, CASE WHEN $3::date = (now() AT TIME ZONE $4)::date THEN now() ELSE ($3::date + time '23:59' ) AT TIME ZONE $4 END, $5, $6) RETURNING id, snapshot_at`,
    [ctx.businessId, job.id, date, ctx.timezone, ctx.userId, rows.length],
  );
  let adjusted = 0;
  let unchanged = 0;
  for (const r of rows) {
    const bal = await db.one<{ before: string }>(
      `SELECT coalesce(sum(quantity), 0) AS before FROM inventory_movements WHERE business_id = $1 AND product_id = $2 AND occurred_at <= $3`,
      [ctx.businessId, r.productId, snap.snapshot_at],
    );
    const before = Number(bal.before);
    const delta = Math.round((r.qty - before) * 1000) / 1000;
    await db.query(
      `INSERT INTO stock_snapshot_lines (business_id, snapshot_id, product_id, counted_qty, system_qty_before) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (snapshot_id, product_id) DO NOTHING`,
      [ctx.businessId, snap.id, r.productId, r.qty, before],
    );
    if (delta !== 0) {
      const anyBefore = await db.maybeOne("SELECT 1 FROM inventory_movements WHERE business_id = $1 AND product_id = $2 LIMIT 1", [ctx.businessId, r.productId]);
      await db.query(
        `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, occurred_at, source_type, source_id, idempotency_key, note, created_by)
         VALUES ($1,$2,$3,$4,$5,'snapshot',$6,$7,$8,$9)`,
        [ctx.businessId, r.productId, anyBefore ? "snapshot_adjustment" : "opening", delta, snap.snapshot_at, snap.id, `snapshot:${snap.id}:${r.productId}`, `Stock count from ${job.original_filename}`.slice(0, 300), ctx.userId],
      );
      adjusted++;
    } else unchanged++;
    if (updateCosts && r.unitCost !== null && r.unitCost >= 0) {
      await db.query("UPDATE products SET purchase_cost = $3, updated_at = now() WHERE business_id = $1 AND id = $2", [ctx.businessId, r.productId, r.unitCost / (r.factor || 1)]);
    }
  }
  return { stockCounted: rows.length, stockAdjusted: adjusted, stockUnchanged: unchanged };
}

function dedupeKey(parts: unknown[]) {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

async function commitSales(db: Tx, ctx: Ctx, job: ImportJob, rows: NormalizedRow[]) {
  let inserted = 0;
  const txIds = new Map<string, string>();
  for (const r of rows) {
    const rec = r.record;
    const factor = (rec._unitFactor as number) || 1;
    let transactionId: string | null = null;
    if (rec.invoice_ref) {
      const k = `${rec.invoice_ref}|${rec.date}`;
      transactionId = txIds.get(k) ?? null;
      if (!transactionId) {
        const t = await db.one<{ id: string }>(
          `INSERT INTO sales_transactions (business_id, invoice_ref, sold_on, customer_name, import_job_id) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (business_id, invoice_ref, sold_on) DO UPDATE SET customer_name = coalesce(sales_transactions.customer_name, EXCLUDED.customer_name) RETURNING id`,
          [ctx.businessId, rec.invoice_ref, rec.date, rec.customer ?? null, job.id],
        );
        transactionId = t.id;
        txIds.set(k, t.id);
      }
    }
    const key = dedupeKey(["sale", rec.date, rec._productId, rec.invoice_ref ?? null, rec._baseQty, rec.unit_price ?? null, rec.line_total ?? null, rec._occurrence ?? 1]);
    const unitPrice = rec.unit_price === null || rec.unit_price === undefined ? null : (rec.unit_price as number) / factor;
    const total = rec.line_total ?? (unitPrice !== null ? Math.round((rec._baseQty as number) * unitPrice * 100) / 100 : null);
    const res = await db.query(
      `INSERT INTO sales_lines (business_id, transaction_id, product_id, sold_on, quantity, unit_price, line_total, import_job_id, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (business_id, dedupe_key) DO NOTHING RETURNING id`,
      [ctx.businessId, transactionId, rec._productId, rec.date, rec._baseQty, unitPrice, total, job.id, key],
    );
    inserted += res.length;
  }
  return { salesLinesAdded: inserted, alreadyImported: rows.length - inserted };
}

async function commitPurchases(db: Tx, ctx: Ctx, job: ImportJob, rows: NormalizedRow[]) {
  let inserted = 0;
  const suppliers = new Map<string, string>();
  const latest = new Map<string, { date: string; cost: number; supplierId: string }>();
  for (const r of rows) {
    const rec = r.record;
    const factor = (rec._unitFactor as number) || 1;
    const supplierId = rec.supplier_name ? await findOrCreateSupplier(db, ctx.businessId, rec.supplier_name as string, suppliers) : null;
    const unitCost = rec.unit_cost === null || rec.unit_cost === undefined ? (rec.line_total ? (rec.line_total as number) / (rec._baseQty as number) : null) : (rec.unit_cost as number) / factor;
    const key = dedupeKey(["purchase", rec.date, rec._productId, supplierId, rec.bill_ref ?? null, rec._baseQty, rec.unit_cost ?? null, rec.line_total ?? null, rec._occurrence ?? 1]);
    const res = await db.query(
      `INSERT INTO purchase_history_lines (business_id, supplier_id, product_id, purchased_on, bill_ref, quantity, unit_cost, line_total, import_job_id, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (business_id, dedupe_key) DO NOTHING RETURNING id`,
      [ctx.businessId, supplierId, rec._productId, rec.date, rec.bill_ref ?? null, rec._baseQty, unitCost, rec.line_total ?? null, job.id, key],
    );
    inserted += res.length;
    if (supplierId && unitCost !== null) {
      const k = `${supplierId}|${rec._productId}`;
      const cur = latest.get(k);
      if (!cur || (rec.date as string) >= cur.date) latest.set(k, { date: rec.date as string, cost: unitCost, supplierId });
    }
  }
  for (const [k, v] of latest) {
    const productId = k.split("|")[1];
    await db.query(
      `INSERT INTO supplier_products (business_id, supplier_id, product_id, purchase_price, price_updated_at) VALUES ($1,$2,$3,$4,$5::date)
       ON CONFLICT (supplier_id, product_id) DO UPDATE SET purchase_price = EXCLUDED.purchase_price, price_updated_at = EXCLUDED.price_updated_at
        WHERE supplier_products.price_updated_at IS NULL OR supplier_products.price_updated_at::date <= EXCLUDED.price_updated_at::date`,
      [ctx.businessId, v.supplierId, productId, Math.round(v.cost * 10000) / 10000, v.date],
    );
  }
  return { purchaseLinesAdded: inserted, alreadyImported: rows.length - inserted, suppliersLinked: suppliers.size };
}

async function commitSuppliers(db: Tx, ctx: Ctx, rows: NormalizedRow[]) {
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const rec = r.record;
    const res = await db.one<{ inserted: boolean }>(
      `INSERT INTO suppliers (business_id, name, contact_person, phone, email, gstin, address, city, state, default_lead_time_days, payment_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (business_id, lower(name)) DO UPDATE SET
         contact_person = coalesce(EXCLUDED.contact_person, suppliers.contact_person), phone = coalesce(EXCLUDED.phone, suppliers.phone),
         email = coalesce(EXCLUDED.email, suppliers.email), gstin = coalesce(EXCLUDED.gstin, suppliers.gstin),
         address = coalesce(EXCLUDED.address, suppliers.address), city = coalesce(EXCLUDED.city, suppliers.city), state = coalesce(EXCLUDED.state, suppliers.state),
         default_lead_time_days = coalesce(EXCLUDED.default_lead_time_days, suppliers.default_lead_time_days),
         payment_terms = coalesce(EXCLUDED.payment_terms, suppliers.payment_terms), updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [ctx.businessId, rec.name, rec.contact_person ?? null, rec.phone ?? null, rec.email ?? null, rec.gstin ?? null, rec.address ?? null, rec.city ?? null, rec.state ?? null, rec.lead_time_days ?? null, rec.payment_terms ?? null],
    );
    if (res.inserted) created++;
    else updated++;
  }
  return { created, updated };
}

// ------------------------------------------------------------------ listings, reports, templates

export async function listImports(db: Tx, businessId: string, limit = 50) {
  return db.query<{ id: string; kind: ImportKind; status: string; original_filename: string; row_count: number | null; valid_count: number | null; error_count: number | null; created_at: Date; committed_at: Date | null; summary: ImportJob["summary"] }>(
    "SELECT id, kind, status, original_filename, row_count, valid_count, error_count, created_at, committed_at, summary FROM import_jobs WHERE business_id = $1 ORDER BY created_at DESC LIMIT $2",
    [businessId, limit],
  );
}

export async function listIssues(db: Tx, businessId: string, jobId: string, limit = 200) {
  return db.query<{ row_number: number; field: string | null; severity: "error" | "warning"; code: string; message: string; raw_value: string | null }>(
    "SELECT row_number, field, severity, code, message, raw_value FROM import_row_errors WHERE business_id = $1 AND import_job_id = $2 ORDER BY severity, row_number LIMIT $3",
    [businessId, jobId, limit],
  );
}

export async function errorReportCsv(db: Tx, businessId: string, job: ImportJob): Promise<string> {
  const issues = await db.query<{ row_number: number; field: string | null; severity: string; message: string; raw_value: string | null }>(
    "SELECT row_number, field, severity, message, raw_value FROM import_row_errors WHERE business_id = $1 AND import_job_id = $2 ORDER BY row_number, id",
    [businessId, job.id],
  );
  const sheet = await loadSheet(job);
  const headers = job.headers ?? [];
  const labels = Object.fromEntries(fieldsFor(job.kind).map((f) => [f.key, f.label]));
  return toCsv(
    ["Row", "Severity", "Field", "Problem", "Value", ...headers.map((h) => `Original: ${h}`)],
    issues.map((i) => [i.row_number, i.severity, i.field ? (labels[i.field] ?? i.field) : "", i.message, i.raw_value ?? "", ...(sheet.rows[i.row_number - 1] ?? [])]),
  );
}

export async function cancelImport(db: Tx, ctx: Ctx, jobId: string) {
  const rows = await db.query("UPDATE import_jobs SET status = 'cancelled' WHERE business_id = $1 AND id = $2 AND status IN ('uploaded','validated') RETURNING storage_key", [ctx.businessId, jobId]);
  if (!rows.length) throw new AppError("Only imports that have not been completed can be cancelled.");
}

export const TEMPLATE_EXAMPLES: Record<ImportKind, (string | number | null)[][]> = {
  products: [
    ["MCB-16A-SP", "MCB 16A Single Pole C-Curve", "", "", "Switchgear", "Example Brand", "", "pcs", 186, 242, 24, 120, null, 7, "Rack A-1", "Example Supplier Pvt Ltd", "EX-1601", null],
    ["WIRE-2.5-RED", "FR Copper Wire 2.5 sqmm Red", "", "", "Wires & Cables", "Example Brand", "", "m", 37.5, 46, 180, 900, null, 5, "Rack B-2", "Example Supplier Pvt Ltd", "EX-W25R", null],
  ],
  stock_snapshot: [
    ["MCB-16A-SP", "MCB 16A Single Pole C-Curve", 36, "pcs", 186],
    ["WIRE-2.5-RED", "FR Copper Wire 2.5 sqmm Red", 4, "coil", 3375],
  ],
  sales: [
    ["01/10/2026", "MCB-16A-SP", "MCB 16A Single Pole C-Curve", 6, "pcs", "INV-1001", 242, 1452, "Example Customer"],
    ["01/10/2026", "WIRE-2.5-RED", "FR Copper Wire 2.5 sqmm Red", 90, "m", "INV-1001", 46, 4140, "Example Customer"],
  ],
  purchases: [["28/09/2026", "MCB-16A-SP", "MCB 16A Single Pole C-Curve", 48, "pcs", "Example Supplier Pvt Ltd", "PB-881", 186, 8928]],
  suppliers: [["Example Supplier Pvt Ltd", "R. Kumar", "+91 00000 00000", "orders@example.com", "", "Plot 1, Example Industrial Area", "Pune", "Maharashtra", 7, "30 days"]],
};

export function templateFor(kind: ImportKind) {
  const fields = fieldsFor(kind);
  const headers = fields.map((f) => (f.required ? `${f.label} *` : f.label));
  const rows = TEMPLATE_EXAMPLES[kind].map((r) => fields.map((_, i) => r[i] ?? null));
  const notes = [
    `StockPilot ${IMPORT_KINDS[kind].label} template. Columns marked * are required. The example rows are made up — replace them with your data.`,
    IMPORT_KINDS[kind].description,
    ...fields.map((f) => `${f.label}: also recognised as ${f.synonyms.slice(0, 6).map((s) => `"${s}"`).join(", ")}${f.help ? ` — ${f.help}` : ""}`),
  ];
  return { headers, rows, notes };
}
