import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { setProviderForTests, type AIProvider, type ChatMessage } from "@/lib/ai/provider";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import { parseBusinessSettings } from "@/lib/domain/settings";
import { ask } from "@/lib/services/assistant/assistant";
import { seedDemoData } from "@/lib/services/demo";
import { createBusiness } from "@/lib/services/workspaces";
import { todayIn } from "@/lib/domain/dates";
import { resetTestDatabase } from "./db";

let ctx: { userId: string; businessId: string; settings: ReturnType<typeof parseBusinessSettings>["analysis"]; timezone: string };
let other: { userId: string; businessId: string };

function fakeProvider(handlers: { route?: unknown; interpret?: (facts: string) => unknown }): AIProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    name: "fake",
    model: "fake-model",
    calls,
    health: async () => ({ ok: true, message: "" }),
    async chatJSON<T>(messages: ChatMessage[], schema: z.ZodType<T>) {
      calls.push(messages);
      const isRoute = messages[0].content.startsWith("You route");
      const raw = isRoute ? handlers.route : handlers.interpret?.(messages[1].content);
      const parsed = schema.safeParse(raw);
      return parsed.success
        ? { ok: true as const, data: parsed.data, usage: { promptTokens: 50, completionTokens: 20 }, latencyMs: 3, model: "fake-model" }
        : { ok: false as const, reason: "invalid_output" as const, message: "invalid", latencyMs: 3, model: "fake-model" };
    },
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  const u = await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ('ask@test.local', 'Ask', 'x') RETURNING id"));
  const b = await createBusiness(u.id, { name: "Assistant Test Electricals", industry: "electrical" });
  await withAdmin((tx) => seedDemoData(tx, b.id, u.id, todayIn("Asia/Kolkata")));
  ctx = { userId: u.id, businessId: b.id, settings: parseBusinessSettings({}).analysis, timezone: "Asia/Kolkata" };
  const u2 = await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ('ask2@test.local', 'Ask2', 'x') RETURNING id"));
  const b2 = await createBusiness(u2.id, { name: "Other Business", industry: "hardware" });
  other = { userId: u2.id, businessId: b2.id };
});

afterEach(() => setProviderForTests(undefined));
afterAll(closePools);

describe("Ask StockPilot", () => {
  it("answers from the workspace's own data with AI turned off", async () => {
    setProviderForTests(null);
    const a = await withTenant(ctx, (tx) => ask(tx, ctx, "Which 20 products should I consider ordering this week?"));
    expect(a.aiStatus).toBe("not_configured");
    expect(a.tool?.tool).toBe("reorder_candidates");
    expect(a.result?.rows.length).toBeGreaterThan(0);
    expect(a.result?.rows.length).toBeLessThanOrEqual(20);
    expect(a.result?.summary).toMatch(/at or below their reorder point/);
    expect(a.interpretation).toBeNull();
  });

  it("shows a validated AI interpretation that only uses figures from the data", async () => {
    const fake = fakeProvider({
      route: { tool: "not_sold", params: { days: 90 } },
      interpret: (facts) => {
        const f = JSON.parse(facts.split("Data (JSON):\n")[1]);
        return { summary: `${f.totals.confirmed_items} items have not sold in 90 days.`, points: [], cited_skus: [f.rows[0].sku] };
      },
    });
    setProviderForTests(fake);
    const a = await withTenant(ctx, (tx) => ask(tx, ctx, "anything that hasn't moved?"));
    expect(a.aiStatus).toBe("used");
    expect(a.interpretation?.summary).toMatch(/items have not sold in 90 days/);
    // only filtered, aggregated data was sent: at most 20 rows, never the whole catalogue
    const sent = JSON.parse(fake.calls[1][1].content.split("Data (JSON):\n")[1]);
    expect(sent.rows.length).toBeLessThanOrEqual(20);
    const usage = await withTenant(ctx, (tx) => tx.one<{ calls: number; questions: number }>("SELECT count(*)::int AS calls, count(DISTINCT request_id)::int AS questions FROM ai_usage WHERE feature = 'assistant'"));
    expect(usage).toEqual({ calls: 2, questions: 1 });
  });

  it("drops an interpretation with invented figures and still shows the data", async () => {
    setProviderForTests(fakeProvider({ route: { tool: "slow_stock_value", params: {} }, interpret: () => ({ summary: "You can free up ₹9,99,999 by Diwali.", points: [], cited_skus: [] }) }));
    const a = await withTenant(ctx, (tx) => ask(tx, ctx, "how much money is stuck?"));
    expect(a.aiStatus).toBe("rejected");
    expect(a.interpretation).toBeNull();
    expect(a.result?.rows.length).toBeGreaterThan(0);
  });

  it("falls back to the keyword router when the model picks an invalid tool", async () => {
    setProviderForTests(fakeProvider({ route: { tool: "delete_everything", params: {} }, interpret: () => ({ summary: "ok", points: [], cited_skus: [] }) }));
    const a = await withTenant(ctx, (tx) => ask(tx, ctx, "Which suppliers account for the largest share of my purchases?"));
    expect(a.tool?.tool).toBe("supplier_share");
  });

  it("only sees the current tenant's data", async () => {
    setProviderForTests(null);
    const a = await withTenant(other, (tx) => ask(tx, { ...other, settings: ctx.settings, timezone: ctx.timezone }, "What should I order this week?"));
    expect(a.result?.rows).toEqual([]);
    expect(a.result?.empty).toBe(true);
  });

  it("explains why a product is flagged", async () => {
    setProviderForTests(null);
    const sku = (await withTenant(ctx, (tx) => tx.one<{ sku: string }>("SELECT sku FROM products WHERE sku LIKE 'MCB-%' ORDER BY sku LIMIT 1"))).sku;
    const a = await withTenant(ctx, (tx) => ask(tx, ctx, `Why is ${sku} being flagged for reorder?`));
    expect(a.tool?.tool).toBe("explain_product");
    expect(a.result?.title).toContain(sku);
    expect(a.result?.notes.some((n) => n.includes("Reorder point") || n.includes("reorder point") || n.includes("Provisional"))).toBe(true);
  });
});
