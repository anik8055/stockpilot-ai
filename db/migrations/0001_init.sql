-- StockPilot AI — initial schema
-- Conventions:
--   * every tenant table has business_id and RLS enabled
--   * quantities numeric(14,3) in the product's base unit; money numeric(14,2); unit costs numeric(14,4)
--   * inventory_movements is append-only; products.on_hand is maintained only by trigger

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockpilot_app') THEN
    CREATE ROLE stockpilot_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------- tenant context helpers
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_business_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.business_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- identity (owner-only tables)
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  price_inr_monthly numeric(12,2),
  is_custom_price boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  limits jsonb NOT NULL,
  features jsonb NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_public boolean NOT NULL DEFAULT true
);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  legal_name text,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  industry text NOT NULL DEFAULT 'general'
    CHECK (industry IN ('hardware','electrical','auto_parts','wholesale','distribution','general')),
  address_line1 text, address_line2 text, city text, state text, pincode text,
  phone text, email text,
  currency text NOT NULL DEFAULT 'INR',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  plan_code text NOT NULL REFERENCES plans(code) DEFAULT 'trial',
  plan_status text NOT NULL DEFAULT 'trialing' CHECK (plan_status IN ('trialing','active','past_due','cancelled')),
  trial_ends_at timestamptz,
  join_code text UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE memberships (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  active_business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count int NOT NULL
);

CREATE TABLE demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, email citext NOT NULL, phone text, company text, city text,
  industry text, message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email citext NOT NULL,
  template text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','skipped_no_provider','failed')),
  provider text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Membership check usable inside policies without recursion
CREATE OR REPLACE FUNCTION app.is_member(b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = b AND m.user_id = app.current_user_id())
$$;

CREATE OR REPLACE FUNCTION app.tenant_ok(b uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT b IS NOT NULL AND b = app.current_business_id() AND app.is_member(b)
$$;

-- Members of the current business (names/emails only) — app role cannot read users directly
CREATE OR REPLACE FUNCTION app.business_members()
RETURNS TABLE (user_id uuid, name text, email text, role text, joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT u.id, u.name, u.email::text, m.role, m.created_at
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.business_id = app.current_business_id() AND app.is_member(app.current_business_id())
  ORDER BY m.created_at
$$;

-- ---------------------------------------------------------------- catalogue
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  contact_person text, phone text, email text, gstin text,
  address text, city text, state text,
  default_lead_time_days int CHECK (default_lead_time_days IS NULL OR default_lead_time_days BETWEEN 0 AND 365),
  payment_terms text, notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX suppliers_name_uq ON suppliers (business_id, lower(name));

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sku text NOT NULL CHECK (length(sku) BETWEEN 1 AND 80),
  barcode text,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  description text,
  category text, brand text, mpn text,
  base_unit text NOT NULL DEFAULT 'pcs',
  purchase_cost numeric(14,4) CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
  selling_price numeric(14,2) CHECK (selling_price IS NULL OR selling_price >= 0),
  preferred_supplier_id uuid,
  min_stock numeric(14,3) CHECK (min_stock IS NULL OR min_stock >= 0),
  max_stock numeric(14,3) CHECK (max_stock IS NULL OR max_stock >= 0),
  lead_time_days int CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
  safety_stock numeric(14,3) CHECK (safety_stock IS NULL OR safety_stock >= 0),
  storage_location text,
  reserved_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  on_hand numeric(14,3) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, preferred_supplier_id) REFERENCES suppliers(business_id, id),
  CHECK (max_stock IS NULL OR min_stock IS NULL OR max_stock >= min_stock)
);
CREATE UNIQUE INDEX products_sku_uq ON products (business_id, lower(sku));
CREATE UNIQUE INDEX products_barcode_uq ON products (business_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_category_idx ON products (business_id, category);

-- Unit conversions: 1 <unit_code> = factor_to_base × base unit
CREATE TABLE product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  unit_code text NOT NULL CHECK (length(unit_code) BETWEEN 1 AND 20),
  factor_to_base numeric(18,6) NOT NULL CHECK (factor_to_base > 0),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE CASCADE,
  UNIQUE (product_id, unit_code)
);

CREATE TABLE product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  alias_type text NOT NULL CHECK (alias_type IN ('supplier_code','alias','old_sku')),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 120),
  supplier_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX product_aliases_uq ON product_aliases
  (business_id, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(value));

CREATE TABLE supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_sku text,
  purchase_price numeric(14,4) CHECK (purchase_price IS NULL OR purchase_price >= 0),
  purchase_unit text,
  moq numeric(14,3) CHECK (moq IS NULL OR moq > 0),
  pack_size numeric(14,3) CHECK (pack_size IS NULL OR pack_size > 0),
  lead_time_days int CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
  price_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE CASCADE,
  UNIQUE (supplier_id, product_id)
);

-- ---------------------------------------------------------------- imports
CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('products','stock_snapshot','sales','purchases','suppliers')),
  status text NOT NULL CHECK (status IN ('uploaded','validated','committed','failed','cancelled')),
  original_filename text NOT NULL,
  file_sha256 text NOT NULL,
  storage_key text NOT NULL,
  sheet_name text,
  header_row int,
  headers jsonb,
  mapping jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count int, valid_count int, error_count int, warning_count int,
  summary jsonb,
  error_message text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  committed_at timestamptz,
  UNIQUE (business_id, id)
);
CREATE INDEX import_jobs_hash_idx ON import_jobs (business_id, file_sha256);

CREATE TABLE import_row_errors (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  import_job_id uuid NOT NULL,
  row_number int NOT NULL,
  field text,
  severity text NOT NULL CHECK (severity IN ('error','warning')),
  code text NOT NULL,
  message text NOT NULL,
  raw_value text,
  FOREIGN KEY (business_id, import_job_id) REFERENCES import_jobs(business_id, id) ON DELETE CASCADE
);
CREATE INDEX import_row_errors_job_idx ON import_row_errors (import_job_id, row_number);

CREATE TABLE import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  mapping jsonb NOT NULL,
  header_signature text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, kind, name)
);

-- ---------------------------------------------------------------- stock
CREATE TABLE stock_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  import_job_id uuid,
  snapshot_at timestamptz NOT NULL,
  line_count int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, import_job_id) REFERENCES import_jobs(business_id, id)
);

-- Observed counts (what the file said) and what the system had at that moment
CREATE TABLE stock_snapshot_lines (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL,
  product_id uuid NOT NULL,
  counted_qty numeric(14,3) NOT NULL,
  system_qty_before numeric(14,3) NOT NULL,
  FOREIGN KEY (business_id, snapshot_id) REFERENCES stock_snapshots(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id),
  UNIQUE (snapshot_id, product_id)
);

CREATE TABLE inventory_movements (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN
    ('opening','snapshot_adjustment','receipt','manual_adjustment','sale','customer_return','supplier_return','write_off')),
  quantity numeric(14,3) NOT NULL CHECK (quantity <> 0),
  unit_cost numeric(14,4),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_type text NOT NULL CHECK (source_type IN ('import','snapshot','goods_receipt','manual','system')),
  source_id uuid,
  idempotency_key text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id),
  UNIQUE (business_id, idempotency_key)
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements (business_id, product_id, occurred_at);

CREATE OR REPLACE FUNCTION app.apply_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products SET on_hand = on_hand + NEW.quantity, updated_at = now()
   WHERE id = NEW.product_id AND business_id = NEW.business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product % not found for movement', NEW.product_id; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inventory_movements_apply AFTER INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION app.apply_movement();

CREATE OR REPLACE FUNCTION app.block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

-- depth 0 = a direct statement; cascades from deleting a whole business (account deletion) run at depth >= 1
CREATE TRIGGER inventory_movements_immutable BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION app.block_mutation();

-- on_hand may only change through the ledger trigger
CREATE OR REPLACE FUNCTION app.guard_on_hand() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_hand IS DISTINCT FROM OLD.on_hand AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'products.on_hand can only change via inventory_movements';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER products_guard_on_hand BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION app.guard_on_hand();

CREATE OR REPLACE FUNCTION app.guard_on_hand_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.on_hand <> 0 THEN RAISE EXCEPTION 'products.on_hand must start at 0; post an opening movement'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER products_guard_on_hand_insert BEFORE INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION app.guard_on_hand_insert();

-- ---------------------------------------------------------------- sales (demand history only)
CREATE TABLE sales_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_ref text NOT NULL,
  sold_on date NOT NULL,
  customer_name text,
  import_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, invoice_ref, sold_on)
);

CREATE TABLE sales_lines (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  transaction_id uuid,
  product_id uuid NOT NULL,
  sold_on date NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,4),
  line_total numeric(14,2),
  import_job_id uuid,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id),
  FOREIGN KEY (business_id, transaction_id) REFERENCES sales_transactions(business_id, id) ON DELETE CASCADE,
  UNIQUE (business_id, dedupe_key)
);
CREATE INDEX sales_lines_product_date_idx ON sales_lines (business_id, product_id, sold_on);
CREATE INDEX sales_lines_date_idx ON sales_lines (business_id, sold_on);

-- ---------------------------------------------------------------- purchasing
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','partially_received','received','cancelled')),
  order_date date NOT NULL DEFAULT current_date,
  expected_date date,
  notes text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','recommendation','import')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id),
  UNIQUE (business_id, id),
  UNIQUE (business_id, po_number)
);
CREATE INDEX purchase_orders_status_idx ON purchase_orders (business_id, status);

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  line_no int NOT NULL,
  product_id uuid NOT NULL,
  description text,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  unit_factor numeric(18,6) NOT NULL DEFAULT 1 CHECK (unit_factor > 0),
  quantity_base numeric(14,3) GENERATED ALWAYS AS (round(quantity * unit_factor, 3)) STORED,
  unit_price numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  received_qty_base numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_qty_base >= 0),
  recommendation jsonb,
  FOREIGN KEY (business_id, purchase_order_id) REFERENCES purchase_orders(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id),
  UNIQUE (business_id, id),
  UNIQUE (purchase_order_id, line_no)
);

CREATE TABLE invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes int NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('uploaded','needs_review','unsupported','failed','confirmed','discarded')),
  provider text,
  extraction jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  supplier_id uuid,
  supplier_name text,
  supplier_gstin text,
  invoice_number text,
  invoice_date date,
  subtotal numeric(14,2), tax_total numeric(14,2), total numeric(14,2),
  error text,
  purchase_order_id uuid,
  goods_receipt_id uuid,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id),
  UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX invoice_documents_sha_uq ON invoice_documents (business_id, sha256) WHERE status <> 'discarded';

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  line_no int NOT NULL,
  description text NOT NULL,
  supplier_code text,
  hsn text,
  quantity numeric(14,3),
  unit text,
  unit_price numeric(14,4),
  discount_amount numeric(14,2),
  tax_rate numeric(5,2),
  tax_amount numeric(14,2),
  line_total numeric(14,2),
  matched_product_id uuid,
  match_method text,
  match_score numeric(4,3),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  FOREIGN KEY (business_id, invoice_id) REFERENCES invoice_documents(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, matched_product_id) REFERENCES products(business_id, id),
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  purchase_order_id uuid,
  supplier_id uuid NOT NULL,
  invoice_document_id uuid,
  supplier_invoice_ref text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  received_on date NOT NULL DEFAULT current_date,
  notes text,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, purchase_order_id) REFERENCES purchase_orders(business_id, id),
  FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id),
  FOREIGN KEY (business_id, invoice_document_id) REFERENCES invoice_documents(business_id, id),
  UNIQUE (business_id, id),
  UNIQUE (business_id, receipt_number),
  UNIQUE (business_id, idempotency_key)
);

CREATE TABLE goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL,
  purchase_order_line_id uuid,
  product_id uuid NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  unit_factor numeric(18,6) NOT NULL DEFAULT 1 CHECK (unit_factor > 0),
  quantity_base numeric(14,3) GENERATED ALWAYS AS (round(quantity * unit_factor, 3)) STORED,
  unit_cost numeric(14,4),
  FOREIGN KEY (business_id, goods_receipt_id) REFERENCES goods_receipts(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, purchase_order_line_id) REFERENCES purchase_order_lines(business_id, id),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id)
);

-- Historical purchases imported from billing exports (price/supplier history; not stock movements)
CREATE TABLE purchase_history_lines (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id uuid,
  product_id uuid NOT NULL,
  purchased_on date NOT NULL,
  bill_ref text,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4),
  line_total numeric(14,2),
  import_job_id uuid,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id),
  UNIQUE (business_id, dedupe_key)
);
CREATE INDEX purchase_history_product_idx ON purchase_history_lines (business_id, product_id, purchased_on);

-- ---------------------------------------------------------------- reports, audit, usage
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'weekly' CHECK (kind IN ('weekly')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  data jsonb NOT NULL,
  generated_by uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE INDEX reports_business_idx ON reports (business_id, generated_at DESC);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_business_idx ON audit_events (business_id, created_at DESC);
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION app.block_mutation();

CREATE TABLE ai_usage (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid,
  feature text NOT NULL CHECK (feature IN ('assistant','invoice_extraction')),
  provider text NOT NULL,
  model text,
  status text NOT NULL CHECK (status IN ('ok','error','invalid_output','timeout','rate_limited','skipped')),
  prompt_tokens int, completion_tokens int,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_business_month_idx ON ai_usage (business_id, feature, created_at);

CREATE TABLE assistant_messages (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_idx ON assistant_messages (business_id, user_id, created_at);

-- Per-business counters for human-readable document numbers (PO-0001, GRN-0001)
CREATE TABLE document_counters (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  next_value int NOT NULL DEFAULT 1,
  PRIMARY KEY (business_id, kind)
);

-- ---------------------------------------------------------------- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'suppliers','products','product_units','product_aliases','supplier_products',
    'import_jobs','import_row_errors','import_mappings','stock_snapshots','stock_snapshot_lines',
    'inventory_movements','sales_transactions','sales_lines','purchase_orders','purchase_order_lines',
    'invoice_documents','invoice_lines','goods_receipts','goods_receipt_lines','purchase_history_lines',
    'reports','audit_events','ai_usage','assistant_messages','document_counters']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO stockpilot_app USING (app.tenant_ok(business_id)) WITH CHECK (app.tenant_ok(business_id))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO stockpilot_app', t);
  END LOOP;
END $$;

-- Append-only tables: no UPDATE/DELETE for the app role
REVOKE UPDATE, DELETE ON inventory_movements, audit_events, stock_snapshot_lines FROM stockpilot_app;

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY businesses_member_select ON businesses FOR SELECT TO stockpilot_app USING (app.is_member(id));
CREATE POLICY businesses_current_update ON businesses FOR UPDATE TO stockpilot_app
  USING (app.tenant_ok(id)) WITH CHECK (app.tenant_ok(id));
GRANT SELECT, UPDATE ON businesses TO stockpilot_app;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT TO stockpilot_app
  USING (user_id = app.current_user_id() OR app.tenant_ok(business_id));
CREATE POLICY memberships_manage ON memberships FOR UPDATE TO stockpilot_app
  USING (app.tenant_ok(business_id)) WITH CHECK (app.tenant_ok(business_id));
CREATE POLICY memberships_delete ON memberships FOR DELETE TO stockpilot_app USING (app.tenant_ok(business_id));
GRANT SELECT, UPDATE, DELETE ON memberships TO stockpilot_app;

GRANT SELECT ON plans TO stockpilot_app;
GRANT USAGE ON SCHEMA public, app TO stockpilot_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO stockpilot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stockpilot_app;
-- identity tables (users, sessions, password_reset_tokens, rate_limits, demo_requests, outbound_emails)
-- are intentionally NOT granted to the app role.
