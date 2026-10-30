import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withAdmin, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, ForbiddenError, logError } from "@/lib/errors";

/**
 * Online billing with Razorpay Subscriptions.
 *
 * Flow: the owner picks a plan → we create a Razorpay subscription server-side and send the owner to Razorpay's hosted
 * payment page (`short_url`) → Razorpay sends signed webhooks → we re-fetch the subscription from Razorpay (so
 * out-of-order or replayed events can't regress state) and only then change the workspace's plan.
 *
 * Nothing here pretends a payment happened: plans change only from a verified webhook or an explicit status refresh
 * that reads the subscription from Razorpay's API.
 */

export type RazorpaySubscription = {
  id: string;
  plan_id: string;
  status: "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "expired" | string;
  current_end: number | null;
  short_url?: string | null;
  notes?: Record<string, string> | unknown[] | null;
};

export interface BillingClient {
  createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }): Promise<RazorpaySubscription>;
  fetchSubscription(id: string): Promise<RazorpaySubscription>;
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<RazorpaySubscription>;
}

class RazorpayClient implements BillingClient {
  constructor(private base: string, private keyId: string, private keySecret: string) {}
  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<RazorpaySubscription> {
    let res: Response;
    try {
      res = await fetch(`${this.base.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      logError("billing.razorpay.network", err);
      throw new AppError("Could not reach the payment provider. Please try again in a minute.", 502, "billing_unavailable");
    }
    const json = (await res.json().catch(() => null)) as (RazorpaySubscription & { error?: { description?: string } }) | null;
    if (!res.ok || !json) {
      // Razorpay error descriptions are safe, customer-facing text; no request data is logged.
      logError("billing.razorpay.http", Object.assign(new Error(`Razorpay HTTP ${res.status}`), { code: json?.error?.description }));
      throw new AppError(json?.error?.description ? `Payment provider: ${json.error.description}` : "The payment provider rejected the request.", 502, "billing_error");
    }
    return json;
  }
  createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
    return this.call("POST", "/subscriptions", { plan_id: input.planId, total_count: input.totalCount, customer_notify: true, notes: input.notes });
  }
  fetchSubscription(id: string) {
    return this.call("GET", `/subscriptions/${encodeURIComponent(id)}`);
  }
  cancelSubscription(id: string, atCycleEnd: boolean) {
    return this.call("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd });
  }
}

let testClient: BillingClient | null = null;
/** Tests inject a fake Razorpay; never used in application code. */
export function setBillingClientForTests(client: BillingClient | null) {
  testClient = client;
}

/** Plan code → Razorpay plan ID, from RAZORPAY_PLAN_IDS="starter:plan_x,growth:plan_y". */
export function billingPlanIds(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env().RAZORPAY_PLAN_IDS ?? "").split(",")) {
    const [code, id] = part.split(":").map((s) => s?.trim());
    if (code && id) out[code] = id;
  }
  return out;
}

export function billingConfigured(): boolean {
  const e = env();
  return !!(testClient || (e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET)) && !!e.RAZORPAY_WEBHOOK_SECRET && Object.keys(billingPlanIds()).length > 0;
}

function client(): BillingClient {
  if (testClient) return testClient;
  const e = env();
  if (!billingConfigured() || !e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET) {
    throw new AppError("Online payment is not enabled on this installation. Contact us to change your plan.", 400, "billing_off");
  }
  return new RazorpayClient(e.RAZORPAY_API_BASE, e.RAZORPAY_KEY_ID, e.RAZORPAY_KEY_SECRET);
}

/** HMAC-SHA256 of the raw body with the webhook secret, compared in constant time. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

const OPEN = ["created", "authenticated", "active", "pending"];
const PAID = ["authenticated", "active"];
const TERMINAL = ["halted", "cancelled", "completed", "expired"];

export type BillingState = {
  configured: boolean;
  subscribablePlans: string[];
  current: {
    id: string; planCode: string; status: string; shortUrl: string | null; currentEnd: string | null; cancelAtCycleEnd: boolean;
  } | null;
};

/** Read-only billing state for the Settings → Plan tab (tenant connection, RLS applies). */
export async function getBillingState(db: Tx, businessId: string): Promise<BillingState> {
  const row = await db.maybeOne<{
    provider_subscription_id: string; plan_code: string; status: string; short_url: string | null; current_end: Date | null; cancel_at_cycle_end: boolean;
  }>(
    `SELECT provider_subscription_id, plan_code, status, short_url, current_end, cancel_at_cycle_end
       FROM billing_subscriptions WHERE business_id = $1 AND status = ANY($2::text[])
      ORDER BY created_at DESC LIMIT 1`,
    [businessId, OPEN],
  );
  return {
    configured: billingConfigured(),
    subscribablePlans: Object.keys(billingPlanIds()),
    current: row
      ? {
          id: row.provider_subscription_id, planCode: row.plan_code, status: row.status, shortUrl: row.short_url,
          currentEnd: row.current_end ? new Date(row.current_end).toISOString() : null, cancelAtCycleEnd: row.cancel_at_cycle_end,
        }
      : null,
  };
}

type Ctx = { userId: string; businessId: string; role: string };

function assertOwner(ctx: Ctx) {
  if (ctx.role !== "owner") throw new ForbiddenError("Only the workspace owner can manage billing.");
}

/**
 * Starts a subscription for `planCode` and returns the Razorpay payment page URL.
 * Re-uses an unpaid subscription for the same plan; replaces an unpaid one for a different plan.
 */
export async function startSubscription(ctx: Ctx, planCode: string): Promise<string> {
  assertOwner(ctx);
  const planId = billingPlanIds()[planCode];
  if (!billingConfigured()) client(); // throws the "not enabled" message
  if (!planId) throw new AppError("That plan cannot be bought online. Contact us for Business pricing.");
  const c = client();

  const existing = await withAdmin((tx) =>
    tx.query<{ provider_subscription_id: string; plan_code: string; status: string; short_url: string | null }>(
      `SELECT provider_subscription_id, plan_code, status, short_url FROM billing_subscriptions
        WHERE business_id = $1 AND status = ANY($2::text[]) ORDER BY created_at DESC`,
      [ctx.businessId, OPEN],
    ),
  );
  for (const s of existing) {
    if (s.status !== "created") {
      throw new AppError("This workspace already has a subscription. Cancel it first, or contact us to switch plans mid-cycle.");
    }
    if (s.plan_code === planCode && s.short_url) return s.short_url;
    // Unpaid subscription for another plan: cancel it so the customer can't end up paying for two.
    const cancelled = await c.cancelSubscription(s.provider_subscription_id, false);
    await withAdmin((tx) => tx.query("UPDATE billing_subscriptions SET status = $2, updated_at = now() WHERE provider_subscription_id = $1", [s.provider_subscription_id, cancelled.status]));
  }

  // 120 monthly cycles (10 years); the customer can cancel any time.
  const sub = await c.createSubscription({ planId, totalCount: 120, notes: { business_id: ctx.businessId, plan_code: planCode } });
  // https only; plain http is accepted only for a localhost test double (real Razorpay links are https://rzp.io/…).
  if (!sub.short_url || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(sub.short_url)) throw new AppError("The payment provider did not return a payment link. Please try again.", 502, "billing_error");
  await withAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO billing_subscriptions (business_id, provider_subscription_id, provider_plan_id, plan_code, status, short_url, current_end, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8)`,
      [ctx.businessId, sub.id, planId, planCode, sub.status, sub.short_url, sub.current_end, ctx.userId],
    );
    await tx.query(
      "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, metadata) VALUES ($1, $2, 'billing.subscription_started', 'billing', $3)",
      [ctx.businessId, ctx.userId, JSON.stringify({ plan: planCode, subscription: sub.id })],
    );
  });
  return sub.short_url;
}

/** Cancels at the end of the paid period (or immediately if nothing has been charged yet). */
export async function cancelSubscription(ctx: Ctx): Promise<{ endsAt: string | null }> {
  assertOwner(ctx);
  const s = await withAdmin((tx) =>
    tx.maybeOne<{ provider_subscription_id: string; status: string }>(
      `SELECT provider_subscription_id, status FROM billing_subscriptions
        WHERE business_id = $1 AND status = ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`,
      [ctx.businessId, OPEN],
    ),
  );
  if (!s) throw new AppError("There is no subscription to cancel.");
  const atCycleEnd = s.status === "active" || s.status === "pending";
  const sub = await client().cancelSubscription(s.provider_subscription_id, atCycleEnd);
  await withAdmin(async (tx) => {
    await tx.query(
      "UPDATE billing_subscriptions SET cancel_at_cycle_end = $2, updated_at = now() WHERE provider_subscription_id = $1",
      [s.provider_subscription_id, atCycleEnd],
    );
    await applySubscription(tx, sub);
    await tx.query(
      "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, metadata) VALUES ($1, $2, 'billing.subscription_cancelled', 'billing', $3)",
      [ctx.businessId, ctx.userId, JSON.stringify({ subscription: sub.id, atCycleEnd })],
    );
  });
  return { endsAt: atCycleEnd && sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null };
}

/** Re-reads the workspace's latest subscription from Razorpay (for when a webhook is delayed). */
export async function refreshSubscription(ctx: Ctx): Promise<string | null> {
  assertOwner(ctx);
  const s = await withAdmin((tx) =>
    tx.maybeOne<{ provider_subscription_id: string }>(
      "SELECT provider_subscription_id FROM billing_subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1",
      [ctx.businessId],
    ),
  );
  if (!s) return null;
  const sub = await client().fetchSubscription(s.provider_subscription_id);
  await withAdmin((tx) => applySubscription(tx, sub));
  return sub.status;
}

/**
 * Stores Razorpay's current view of a subscription and derives the workspace's plan from it.
 * Only subscriptions we created are accepted (looked up by ID), so a forged or foreign subscription can't change a plan.
 */
async function applySubscription(tx: Tx, sub: RazorpaySubscription): Promise<string | null> {
  const row = await tx.maybeOne<{ business_id: string; plan_code: string; provider_plan_id: string }>(
    "SELECT business_id, plan_code, provider_plan_id FROM billing_subscriptions WHERE provider_subscription_id = $1 FOR UPDATE",
    [sub.id],
  );
  if (!row) return null;
  if (sub.plan_id !== row.provider_plan_id) {
    // Plan changed outside StockPilot (e.g. in the Razorpay dashboard): map it back if we know the plan.
    const code = Object.entries(billingPlanIds()).find(([, id]) => id === sub.plan_id)?.[0];
    if (code) await tx.query("UPDATE billing_subscriptions SET plan_code = $2, provider_plan_id = $3 WHERE provider_subscription_id = $1", [sub.id, code, sub.plan_id]);
    else logError("billing.unknown_plan", new Error("Subscription moved to a plan StockPilot does not know"));
  }
  await tx.query(
    "UPDATE billing_subscriptions SET status = $2, current_end = to_timestamp($3), updated_at = now() WHERE provider_subscription_id = $1",
    [sub.id, sub.status, sub.current_end],
  );
  const { plan_code: planCode } = await tx.one<{ plan_code: string }>("SELECT plan_code FROM billing_subscriptions WHERE provider_subscription_id = $1", [sub.id]);

  if (PAID.includes(sub.status)) {
    await tx.query(
      `UPDATE businesses SET plan_code = $2, plan_status = 'active', trial_ends_at = NULL, plan_period_end = to_timestamp($3), updated_at = now()
        WHERE id = $1`,
      [row.business_id, planCode, sub.current_end],
    );
  } else if (sub.status === "pending") {
    // A renewal charge failed; Razorpay retries. Keep access, show a warning.
    await tx.query("UPDATE businesses SET plan_status = 'past_due', updated_at = now() WHERE id = $1 AND plan_code = $2", [row.business_id, planCode]);
  } else if (TERMINAL.includes(sub.status)) {
    // Downgrade only if no other subscription for this workspace is still paid or retrying.
    const other = await tx.maybeOne(
      "SELECT 1 FROM billing_subscriptions WHERE business_id = $1 AND provider_subscription_id <> $2 AND status = ANY($3::text[])",
      [row.business_id, sub.id, ["authenticated", "active", "pending"]],
    );
    if (!other) {
      await tx.query(
        "UPDATE businesses SET plan_status = 'cancelled', updated_at = now() WHERE id = $1 AND plan_code <> 'trial' AND plan_code <> 'demo'",
        [row.business_id],
      );
    }
  }
  return row.business_id;
}

export type WebhookResult = { status: number; message: string };

/** Handles one Razorpay webhook delivery. `rawBody` must be the exact bytes received. */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null): Promise<WebhookResult> {
  const secret = env().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return { status: 404, message: "billing disabled" };
  if (!verifyWebhookSignature(rawBody, signature, secret)) return { status: 401, message: "invalid signature" };

  let body: { event?: string; payload?: { subscription?: { entity?: { id?: string } } } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, message: "invalid json" };
  }
  const event = String(body.event ?? "");
  const eventId = eventIdHeader?.slice(0, 200) || createHmac("sha256", "event-id").update(rawBody).digest("hex");
  const subId = body.payload?.subscription?.entity?.id;
  if (!event.startsWith("subscription.") || !subId) return { status: 200, message: "ignored" };

  const seen = await withAdmin((tx) => tx.maybeOne("SELECT 1 FROM billing_events WHERE event_id = $1", [eventId]));
  if (seen) return { status: 200, message: "duplicate" };

  // Re-fetch the authoritative state rather than trusting the event's snapshot (events can arrive out of order).
  const known = await withAdmin((tx) => tx.maybeOne("SELECT 1 FROM billing_subscriptions WHERE provider_subscription_id = $1", [subId]));
  if (!known) {
    await withAdmin((tx) => tx.query("INSERT INTO billing_events (event_id, event, provider_subscription_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [eventId, event, subId]));
    return { status: 200, message: "unknown subscription" };
  }
  const sub = await client().fetchSubscription(subId); // throws → 5xx → Razorpay retries later
  if (sub.id !== subId) return { status: 400, message: "subscription mismatch" };

  return withAdmin(async (tx) => {
    const inserted = await tx.query("INSERT INTO billing_events (event_id, event, provider_subscription_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1", [eventId, event, subId]);
    if (!inserted.length) return { status: 200, message: "duplicate" };
    const businessId = await applySubscription(tx, sub);
    await tx.query("UPDATE billing_events SET business_id = $2 WHERE event_id = $1", [eventId, businessId]);
    if (businessId) {
      await tx.query(
        "INSERT INTO audit_events (business_id, action, entity_type, metadata) VALUES ($1, 'billing.webhook', 'billing', $2)",
        [businessId, JSON.stringify({ event, status: sub.status, subscription: sub.id })],
      );
    }
    return { status: 200, message: "ok" };
  });
}

/**
 * Before a workspace is deleted, cancel its open subscriptions immediately so the customer is not charged again.
 * Throws if Razorpay can't be reached — deletion must not proceed while a subscription may still bill.
 */
export async function cancelSubscriptionsForDeletion(businessIds: string[]) {
  if (!businessIds.length) return;
  const open = await withAdmin((tx) =>
    tx.query<{ provider_subscription_id: string }>(
      "SELECT provider_subscription_id FROM billing_subscriptions WHERE business_id = ANY($1::uuid[]) AND status = ANY($2::text[])",
      [businessIds, OPEN],
    ),
  );
  for (const s of open) {
    try {
      await client().cancelSubscription(s.provider_subscription_id, false);
    } catch (err) {
      logError("billing.cancel_on_delete", err);
      throw new AppError("We could not cancel your subscription with the payment provider, so nothing was deleted. Please try again or contact support.", 502, "billing_error");
    }
  }
}
