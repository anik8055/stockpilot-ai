-- Plan catalogue. Prices are indicative hypotheses, not validated market prices.
-- Limits are enforced server-side in src/lib/services/entitlements.ts. Edit here (new migration) or via SQL.
INSERT INTO plans (code, name, price_inr_monthly, is_custom_price, description, limits, features, sort_order, is_public) VALUES
('trial', 'Free trial', 0, false, '14-day trial with Growth features and a small AI allowance.',
 '{"max_products": 2000, "max_members": 3, "max_workspaces_per_owner": 1, "imports_per_month": 50, "ai_requests_per_month": 30, "invoice_extractions_per_month": 10}',
 '{"reorder_engine": true, "supplier_analysis": true, "assistant": true, "invoice_extraction": true, "advanced_reports": true}', 0, false),
('demo', 'Demo workspace', 0, false, 'Synthetic demo data for exploring the product.',
 '{"max_products": 2000, "max_members": 1, "max_workspaces_per_owner": 1, "imports_per_month": 20, "ai_requests_per_month": 20, "invoice_extractions_per_month": 5}',
 '{"reorder_engine": true, "supplier_analysis": true, "assistant": true, "invoice_extraction": true, "advanced_reports": true}', 0, false),
('starter', 'Starter', 2499, false, 'For a single shop getting stock under control.',
 '{"max_products": 1000, "max_members": 2, "max_workspaces_per_owner": 1, "imports_per_month": 30, "ai_requests_per_month": 0, "invoice_extractions_per_month": 0}',
 '{"reorder_engine": false, "supplier_analysis": false, "assistant": false, "invoice_extraction": false, "advanced_reports": false}', 1, true),
('growth', 'Growth', 4999, false, 'Reorder planning, supplier analysis and AI assistance.',
 '{"max_products": 10000, "max_members": 5, "max_workspaces_per_owner": 2, "imports_per_month": 200, "ai_requests_per_month": 300, "invoice_extractions_per_month": 100}',
 '{"reorder_engine": true, "supplier_analysis": true, "assistant": true, "invoice_extraction": true, "advanced_reports": true}', 2, true),
('business', 'Business', NULL, true, 'Multiple staff, higher limits and priority support.',
 '{"max_products": 50000, "max_members": 25, "max_workspaces_per_owner": 5, "imports_per_month": 1000, "ai_requests_per_month": 1500, "invoice_extractions_per_month": 500}',
 '{"reorder_engine": true, "supplier_analysis": true, "assistant": true, "invoice_extraction": true, "advanced_reports": true}', 3, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, price_inr_monthly = EXCLUDED.price_inr_monthly, is_custom_price = EXCLUDED.is_custom_price,
  description = EXCLUDED.description, limits = EXCLUDED.limits, features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order, is_public = EXCLUDED.is_public;
