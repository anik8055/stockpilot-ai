import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import {
  billingConfigured, cancelSubscription, getBillingState, handleRazorpayWebhook, refreshSubscription, setBillingClientForTests,
  startSubscription, verifyWebhookSignature, type BillingClient, type RazorpaySubscription,
} from "@/lib/services/billing";
import { getEntitlements } from "@/lib/services/entitlements";
import { createBusiness, deleteBusiness, joinBusinessByCode } from "@/lib/services/workspaces";
import { resetTestDatabase } from "./db";

// Billing configuration for this test file (read lazily by env()).
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test_only";
process.env.RAZORPAY_PLAN_IDS = "starter:plan_STARTER0000001,growth:plan_GROWTH00000001";

/** In-memory stand-in for Razorpay's Subscriptions API (the real API is not reachable from the test environment). */
class FakeRazorpay implements BillingClient {
  subs = new Map<string, RazorpaySubscription>();
  calls: string[] = [];
  failCancel = false;
  private n = 0;
  async createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
    this.calls.push(`create:${input.planId}:${input.totalCount}`);
    const id = `sub_TEST${String(++this.n).padStart(10, "0")}`;
    const sub = { id, plan_id: input.planId, status: "created", current_end: null, short_url: `https://rzp.io/i/${id}`, notes: input.notes };
    this.subs.set(id, sub);
    return { ...sub };
  }
  async fetchSubscription(id: string) {
    this.calls.push(`fetch:${id}`);
    const s = this.subs.get(id);
    if (!s) throw new Error("not found");
    return { ...s };
  }
  async cancelSubscription(id: string, atCycleEnd: boolean) {
    this.calls.push(`cancel:${id}:${atCycleEnd}`);
    if (this.failCancel) throw new Error("network down");
    const s = this.subs.get(id)!;
    if (!atCycleEnd) s.status = "cancelled";
    return { ...s };
  }
  set(id: string, patch: Partial<RazorpaySubscription>) {
    Object.assign(this.subs.get(id)!, patch);
  }
}

const fake = new FakeRazorpay();
let owner: string;
let staff: string;
let biz: string;
let eventSeq = 0;

async function user(email: string) {
  return (await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ($1, 'U', 'x') RETURNING id", [email]))).id;
}
function webhook(event: string, subId: string, opts: { eventId?: string; secret?: string; status?: string } = {}) {
  const body = JSON.stringify({ entity: "event", event, contains: ["subscription"], payload: { subscription: { entity: { id: subId, status: opts.status ?? "active" } } } });
  const sig = createHmac("sha256", opts.secret ?? "whsec_test_only").update(body).digest("hex");
  return handleRazorpayWebhook(body, sig, opts.eventId ?? `evt_${++eventSeq}`);
}
const business = () =>
  withAdmin((tx) => tx.one<{ plan_code: string; plan_status: string; trial_ends_at: Date | null }>("SELECT plan_code, plan_status, trial_ends_at FROM businesses WHERE id = $1", [biz]));
const ownerCtx = () => ({ userId: owner, businessId: biz, role: "owner" as const });

beforeAll(async () => {
  await resetTestDatabase();
  setBillingClientForTests(fake);
  owner = await user("billing-owner@test.local");
  staff = await user("billing-staff@test.local");
  const b = await createBusiness(owner, { name: "Billing Test", industry: "general" });
  biz = b.id;
  const code = (await withAdmin((tx) => tx.one<{ join_code: string }>("SELECT join_code FROM businesses WHERE id = $1", [biz]))).join_code;
  await joinBusinessByCode(staff, code);
});
afterAll(async () => {
  setBillingClientForTests(null);
  await closePools();
});
beforeEach(() => {
  fake.calls = [];
});

describe("webhook signatures", () => {
  it("accepts only an HMAC-SHA256 of the exact raw body", () => {
    const body = '{"event":"subscription.activated"}';
    const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, "zz", "s3cret")).toBe(false);
  });
});

describe("Razorpay subscriptions", () => {
  let subId: string;

  it("is configured and only lets the owner start a subscription", async () => {
    expect(billingConfigured()).toBe(true);
    await expect(startSubscription({ userId: staff, businessId: biz, role: "staff" }, "growth")).rejects.toThrow(/owner/);
    await expect(startSubscription(ownerCtx(), "business")).rejects.toThrow(/cannot be bought online/);
  });

  it("creates one subscription and re-uses its payment link until paid", async () => {
    const url = await startSubscription(ownerCtx(), "growth");
    expect(url).toMatch(/^https:\/\/rzp\.io\/i\/sub_TEST/);
    expect(await startSubscription(ownerCtx(), "growth")).toBe(url);
    expect(fake.calls.filter((c) => c.startsWith("create"))).toEqual(["create:plan_GROWTH00000001:120"]);
    subId = url.split("/").pop()!;
    expect((await business()).plan_code).toBe("trial"); // nothing changes before payment
  });

  it("switching plans before paying cancels the unpaid subscription", async () => {
    const url = await startSubscription(ownerCtx(), "starter");
    expect(fake.calls).toContain(`cancel:${subId}:false`);
    subId = url.split("/").pop()!;
    const state = await withTenant(ownerCtx(), (tx) => getBillingState(tx, biz));
    expect(state.current).toMatchObject({ id: subId, planCode: "starter", status: "created" });
  });

  it("rejects webhooks with a bad signature and ignores unknown subscriptions", async () => {
    fake.set(subId, { status: "active", current_end: 1_900_000_000 });
    expect(await webhook("subscription.activated", subId, { secret: "wrong" })).toMatchObject({ status: 401 });
    expect((await business()).plan_code).toBe("trial");
    expect(await webhook("subscription.activated", "sub_SOMEONEELSES1")).toMatchObject({ status: 200, message: "unknown subscription" });
  });

  it("activates the plan from a verified webhook, using Razorpay's current state", async () => {
    expect(await webhook("subscription.activated", subId, { eventId: "evt_activate" })).toMatchObject({ status: 200, message: "ok" });
    expect(fake.calls).toContain(`fetch:${subId}`);
    const b = await business();
    expect(b).toMatchObject({ plan_code: "starter", plan_status: "active", trial_ends_at: null });
  });

  it("processes a redelivered event only once", async () => {
    expect(await webhook("subscription.activated", subId, { eventId: "evt_activate" })).toMatchObject({ message: "duplicate" });
    const n = await withAdmin((tx) => tx.one<{ c: number }>("SELECT count(*)::int AS c FROM audit_events WHERE business_id = $1 AND action = 'billing.webhook'", [biz]));
    expect(n.c).toBe(1);
  });

  it("does not regress on a stale out-of-order event", async () => {
    // Event says "pending", but Razorpay now reports the subscription active.
    await webhook("subscription.pending", subId, { status: "pending" });
    expect((await business()).plan_status).toBe("active");
  });

  it("marks the workspace past due while Razorpay retries a failed renewal", async () => {
    fake.set(subId, { status: "pending" });
    await webhook("subscription.pending", subId, { status: "pending" });
    expect((await business()).plan_status).toBe("past_due");
    fake.set(subId, { status: "active" });
    expect(await refreshSubscription(ownerCtx())).toBe("active");
    expect((await business()).plan_status).toBe("active");
  });

  it("refuses a second subscription while one is active", async () => {
    await expect(startSubscription(ownerCtx(), "growth")).rejects.toThrow(/already has a subscription/);
  });

  it("cancels at the end of the paid period, then falls back to Starter features", async () => {
    const { endsAt } = await cancelSubscription(ownerCtx());
    expect(fake.calls).toContain(`cancel:${subId}:true`);
    expect(endsAt).toBe(new Date(1_900_000_000 * 1000).toISOString());
    expect((await business()).plan_status).toBe("active"); // still paid for this period
    fake.set(subId, { status: "cancelled" });
    await webhook("subscription.cancelled", subId, { status: "cancelled" });
    expect((await business()).plan_status).toBe("cancelled");
    const ent = await withTenant(ownerCtx(), (tx) => getEntitlements(tx, biz));
    expect(ent.features.assistant).toBe(false);
  });

  it("the app database role cannot change plan fields directly", async () => {
    await expect(withTenant(ownerCtx(), (tx) => tx.query("UPDATE businesses SET plan_code = 'business', plan_status = 'active' WHERE id = $1", [biz]))).rejects.toThrow(/permission denied/);
    await withTenant(ownerCtx(), (tx) => tx.query("UPDATE businesses SET name = 'Renamed' WHERE id = $1", [biz]));
  });

  it("cancels an open subscription before deleting a workspace, and deletes nothing if that fails", async () => {
    const url = await startSubscription(ownerCtx(), "growth");
    const id = url.split("/").pop()!;
    fake.set(id, { status: "active", current_end: 1_900_000_000 });
    await webhook("subscription.activated", id);
    fake.failCancel = true;
    await expect(deleteBusiness(ownerCtx())).rejects.toThrow(/nothing was deleted/);
    expect(await withAdmin((tx) => tx.maybeOne("SELECT 1 FROM businesses WHERE id = $1", [biz]))).not.toBeNull();
    fake.failCancel = false;
    await deleteBusiness(ownerCtx());
    expect(fake.calls).toContain(`cancel:${id}:false`);
    expect(await withAdmin((tx) => tx.maybeOne("SELECT 1 FROM businesses WHERE id = $1", [biz]))).toBeNull();
  });
});
