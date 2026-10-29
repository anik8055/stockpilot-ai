import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAICompatibleProvider } from "@/lib/ai/provider";
import { routeQuestion, validateInterpretation } from "@/lib/services/assistant/router";
import type { ToolResult } from "@/lib/services/assistant/tools";

describe("keyword router", () => {
  it.each([
    ["Which 20 products should I consider ordering this week?", "reorder_candidates", { limit: 20 }],
    ["Which products have not sold in 90 days?", "not_sold", { days: 90 }],
    ["How much money is tied up in slow-moving stock?", "slow_stock_value", {}],
    ["Which suppliers account for the largest share of my purchases?", "supplier_share", {}],
    ["Why is MCB-SP-16A being flagged for reorder?", "explain_product", { product: "MCB-SP-16A" }],
    ["What changed in my stock position this month?", "stock_changes", { days: 30 }],
    ["Show me items with rising demand and low remaining stock.", "rising_low_stock", {}],
  ])("%s → %s", (q, tool, params) => {
    const r = routeQuestion(q);
    expect(r?.tool).toBe(tool);
    expect(r?.params).toMatchObject(params);
  });
  it("returns null for unrelated questions", () => {
    expect(routeQuestion("Tell me a joke")).toBeNull();
  });
});

const result: ToolResult = {
  tool: "reorder_candidates",
  title: "Top 2 items to consider ordering",
  period: "2026-08-01 to 2026-10-28 (imported sales data)",
  columns: [],
  rows: [
    { sku: "MCB-16", name: "MCB", suggested: 48, cost: 8928.5 },
    { sku: "WIRE-25", name: "Wire", suggested: 180, cost: 6750 },
  ],
  productIds: ["a", "b"],
  totals: { items: 7, estimated_cost_shown: 15678.5 },
  notes: [],
  summary: "",
  empty: false,
};

describe("interpretation validation (hallucination guard)", () => {
  it("accepts text that only uses figures from the data, in common formats", () => {
    expect(validateInterpretation({ summary: "Order 48 MCB-16 and 180 m of WIRE-25, about ₹15,678.5 in total. 7 items need review.", points: ["MCB-16 costs ₹8,928.5"], cited_skus: ["MCB-16", "wire-25"] }, result)).toEqual({ ok: true });
  });
  it("rejects invented numbers", () => {
    const r = validateInterpretation({ summary: "You will save ₹50,000 by ordering 48 units.", points: [], cited_skus: [] }, result);
    expect(r.ok).toBe(false);
  });
  it("rejects arithmetic the model did itself", () => {
    // 48 + 180 = 228 is not in the data
    expect(validateInterpretation({ summary: "Order 228 units in total.", points: [], cited_skus: [] }, result).ok).toBe(false);
  });
  it("rejects SKUs that are not in the result", () => {
    expect(validateInterpretation({ summary: "Order MCB-16.", points: [], cited_skus: ["FAKE-1"] }, result).ok).toBe(false);
  });
});

describe("OpenAI-compatible provider", () => {
  const schema = z.object({ answer: z.string() });
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

  it("parses and validates JSON output", async () => {
    const p = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 2000, 100, async () => ok('{"answer":"hi"}'));
    const r = await p.chatJSON([{ role: "user", content: "x" }], schema);
    expect(r).toMatchObject({ ok: true, data: { answer: "hi" }, usage: { promptTokens: 10 } });
  });

  it("reports invalid output instead of passing it through", async () => {
    const p = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 2000, 100, async () => ok('{"wrong":1}'));
    expect(await p.chatJSON([{ role: "user", content: "x" }], schema)).toMatchObject({ ok: false, reason: "invalid_output" });
    const p2 = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 2000, 100, async () => ok("not json"));
    expect(await p2.chatJSON([{ role: "user", content: "x" }], schema)).toMatchObject({ ok: false, reason: "invalid_output" });
  });

  it("retries once on rate limits / server errors, then gives up cleanly", async () => {
    let calls = 0;
    const p = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 2000, 100, async () => {
      calls++;
      return calls === 1 ? new Response("busy", { status: 429, headers: { "retry-after": "0" } }) : ok('{"answer":"second"}');
    });
    expect(await p.chatJSON([{ role: "user", content: "x" }], schema)).toMatchObject({ ok: true, data: { answer: "second" } });
    let n = 0;
    const p2 = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 2000, 100, async () => {
      n++;
      return new Response("down", { status: 503, headers: { "retry-after": "0" } });
    });
    expect(await p2.chatJSON([{ role: "user", content: "x" }], schema)).toMatchObject({ ok: false, reason: "provider_error" });
    expect(n).toBe(2);
  });

  it("times out without retrying", async () => {
    let n = 0;
    const p = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 50, 100, async (_u, init) => {
      n++;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    });
    expect(await p.chatJSON([{ role: "user", content: "x" }], schema)).toMatchObject({ ok: false, reason: "timeout" });
    expect(n).toBe(1);
  });

  it("does not throw on network failure", async () => {
    const p = new OpenAICompatibleProvider("test", "https://example.invalid/v1", "k", "m", 2000, 100, async () => {
      throw new TypeError("fetch failed");
    });
    expect(await p.chatJSON([{ role: "user", content: "x" }], schema)).toMatchObject({ ok: false, reason: "provider_error" });
  });
});
