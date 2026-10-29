# Database design

PostgreSQL 15+ (developed on 16). Migrations live in `db/migrations/*.sql`, are applied in filename order by
`npm run db:migrate`, run in a transaction each and are checksummed — an edited, already-applied migration is refused.

## Roles

| Role | Used by | Rights |
|---|---|---|
| owner (e.g. `stockpilot`, or `postgres` on Supabase) | migrations, auth/session queries, workspace provisioning, rate limits, seeding | owns all objects; bypasses RLS as table owner |
| `stockpilot_app` | every tenant query | `NOBYPASSRLS`; DML on tenant tables only; no access to `users`, `sessions`, `password_reset_tokens`, `rate_limits`, `demo_requests`, `outbound_emails`; no UPDATE/DELETE on `inventory_movements`, `audit_events`, `stock_snapshot_lines` |

## Tenant isolation

Every tenant table has `business_id` and the policy `app.tenant_ok(business_id)`, which requires the row's business to be
the transaction's `app.business_id` **and** the transaction's `app.user_id` to be a member (`app.is_member`, SECURITY
DEFINER, avoids recursive policies). The server sets both with `set_config(..., true)` (transaction-local) inside
`withTenant()`. The business ID comes from the session row, which can only point at a business the user belongs to
(`setActiveBusiness` checks membership in the same UPDATE). Transaction-local settings are compatible with
transaction-mode connection poolers (Supabase Supavisor, PgBouncer).

Composite foreign keys `(business_id, id)` make it impossible for a row in one business to reference another business's
product, supplier or document even through the owner connection.

## Entities

- **Identity:** `users`, `sessions` (SHA-256 token hashes, active workspace), `password_reset_tokens`.
- **Workspaces:** `businesses` (profile, `settings` jsonb for analysis configuration, plan/trial, join code), `memberships` (owner/admin/staff), `plans`.
- **Catalogue:** `products` (cached `on_hand`), `product_units` (explicit conversions), `product_aliases` (supplier codes, aliases, old SKUs), `suppliers`, `supplier_products` (supplier SKU, price, MOQ, pack size, lead time).
- **Stock ledger:** `inventory_movements` — append-only; the only way `products.on_hand` changes (trigger). Each movement has a unique `idempotency_key` per business. `stock_snapshots` + `stock_snapshot_lines` record what a count/billing export said and what the system had at that moment.
- **Demand & history:** `sales_transactions`, `sales_lines` (dedupe keys), `purchase_history_lines` (dedupe keys). These never post stock movements.
- **Purchasing:** `purchase_orders`, `purchase_order_lines` (`quantity_base` generated column, `received_qty_base`), `goods_receipts` (unique `idempotency_key`), `goods_receipt_lines`.
- **Invoices:** `invoice_documents` (unique file hash per business), `invoice_lines` (matched product, method, score).
- **Imports:** `import_jobs`, `import_row_errors`, `import_mappings`.
- **Other:** `reports` (frozen JSON), `audit_events` (append-only), `ai_usage` (quota and cost tracking), `assistant_messages`, `document_counters`, `rate_limits`, `demo_requests`, `outbound_emails`.

## Stock accounting model

| Event | Effect |
|---|---|
| Stock count / billing closing stock import | Movement = counted − ledger balance at the count time (`opening` the first time, then `snapshot_adjustment`). Same file again → 0. |
| Manual count on a product | `manual_adjustment` for the difference, with a reason. |
| Goods receipt confirmed | One `receipt` movement per line (key `receipt:<line id>`); PO `received_qty_base` updated; PO status recalculated. |
| Sales history import | Rows in `sales_lines` only. No stock change. |
| Purchase history import | Rows in `purchase_history_lines`; may update supplier price if newer. No stock change. |
| Product archived | `active = false`; history kept. Products with movements cannot be deleted. |

## Numeric rules

Quantities `numeric(14,3)` in the product's base unit; unit costs `numeric(14,4)`; money `numeric(14,2)`. Line totals are
rounded half-up per line, then summed (`src/lib/domain/money.ts`). `pg` returns numerics as strings; arithmetic on money
uses `decimal.js`.

## Deleting data

Deleting a business cascades to all tenant rows (the append-only triggers only block direct statements, not cascades),
and the application removes the business's storage prefix. Deleting a user removes workspaces where they are the sole
owner.
