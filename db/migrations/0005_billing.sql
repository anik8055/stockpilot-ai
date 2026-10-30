-- Online billing (Razorpay subscriptions) and column-level protection of plan fields.

-- The app role may only change profile/settings columns of a business — never plan_code/plan_status/trial_ends_at,
-- which are changed by verified payment webhooks or an operator (owner connection).
REVOKE UPDATE ON businesses FROM stockpilot_app;
GRANT UPDATE (name, legal_name, industry, gstin, address_line1, address_line2, city, state, pincode, phone, email,
              settings, join_code, updated_at) ON businesses TO stockpilot_app;

ALTER TABLE businesses ADD COLUMN plan_period_end timestamptz;

CREATE TABLE billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  provider_subscription_id text NOT NULL UNIQUE,
  provider_plan_id text NOT NULL,
  plan_code text NOT NULL REFERENCES plans(code),
  status text NOT NULL,
  short_url text,
  current_end timestamptz,
  cancel_at_cycle_end boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_subscriptions_business_idx ON billing_subscriptions(business_id, created_at DESC);

-- Webhook deliveries already processed (Razorpay may deliver an event more than once).
CREATE TABLE billing_events (
  event_id text PRIMARY KEY,
  event text NOT NULL,
  provider_subscription_id text,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Members can see their workspace's subscriptions; only the owner connection writes them.
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_subscriptions TO stockpilot_app USING (app.tenant_ok(business_id));
GRANT SELECT ON billing_subscriptions TO stockpilot_app;
-- billing_events: no grants to the app role.
