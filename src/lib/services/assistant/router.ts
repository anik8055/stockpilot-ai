import { z } from "zod";
import type { ToolCall, ToolResult } from "./tools";

/** Keyword router used when no AI provider is configured (and as a fallback when the model's choice is invalid). */
export function routeQuestion(q: string): ToolCall | null {
  const s = q.toLowerCase();
  const days = Number(s.match(/(\d{1,3})\s*(?:days?|d\b)/)?.[1]) || (/\bmonth\b/.test(s) ? 30 : /\bquarter\b/.test(s) ? 90 : /\bweek\b/.test(s) && !/this week/.test(s) ? 7 : undefined);
  const limit = Number(s.match(/\b(?:top\s+)?(\d{1,2})\s+(?:products|items|skus)\b/)?.[1]) || undefined;
  const why = s.match(/why\s+(?:is|was|are)\s+(.+?)\s+(?:being\s+)?(?:flagged|recommended|suggested|on the list|low)/);
  const sku = q.match(/\b([A-Z0-9]{2,}[-/][A-Z0-9-/]{2,})\b/);
  if (why || (/\bwhy\b/.test(s) && sku)) return { tool: "explain_product", params: { product: (sku?.[1] ?? why?.[1] ?? "").trim() } };
  if (/rising|increasing|growing|picking up/.test(s)) return { tool: "rising_low_stock", params: { limit } };
  if (/supplier|vendor/.test(s) && /share|largest|most|top|biggest|purchases|spend/.test(s)) return { tool: "supplier_share", params: { days } };
  if (/(not|n't|never|no)\s+(been\s+)?(sold|selling|moved|moving)|dead stock|non[- ]moving/.test(s)) return { tool: "not_sold", params: { days: days ?? 90, limit } };
  if (/tied up|stuck|blocked|excess|slow[- ]moving|overstock/.test(s)) return { tool: "slow_stock_value", params: { days } };
  if (/(order|reorder|buy|purchase).*(this week|today|soon|now|should)|what should i (order|buy)|which .* (order|buy)/.test(s)) return { tool: "reorder_candidates", params: { limit } };
  if (/changed|change in|movement|what happened/.test(s)) return { tool: "stock_changes", params: { days: days ?? 30 } };
  if (/overview|summary|how (is|are) (my|the) stock|position/.test(s)) return { tool: "overview", params: {} };
  if (/order|reorder|low stock|running out|stockout/.test(s)) return { tool: "reorder_candidates", params: { limit } };
  return null;
}

export const interpretationSchema = z.object({
  summary: z.string().min(1).max(900),
  points: z.array(z.string().max(300)).max(5).default([]),
  cited_skus: z.array(z.string().max(80)).max(30).default([]),
});
export type Interpretation = z.infer<typeof interpretationSchema>;

/** Collects every number that appears in the tool result, in forms the model might write them. */
function allowedNumbers(r: ToolResult): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.abs(n), Math.round(Math.abs(n))]) out.add(String(v));
    for (const [unit, min] of [[1e5, 1e5], [1e7, 1e7]] as const) {
      // lakh / crore forms ("₹3.8 L", "₹1.2 Cr")
      if (Math.abs(n) >= min) {
        out.add(String(Math.round((n / unit) * 100) / 100));
        out.add(String(Math.round((n / unit) * 10) / 10));
      }
    }
    if (Math.abs(n) >= 1e3) out.add(String(Math.round(n / 1e3))); // "12k"
  };
  const visit = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") for (const m of v.matchAll(/-?\d[\d,]*\.?\d*/g)) add(Number(m[0].replace(/,/g, "")));
  };
  for (const row of r.rows) Object.values(row).forEach(visit);
  Object.values(r.totals).forEach(visit);
  r.notes.forEach(visit);
  visit(r.summary);
  visit(r.title);
  visit(r.period);
  return out;
}

/**
 * Rejects interpretations that cite unknown SKUs or contain figures that are not in the tool output.
 * Small integers (≤ 10) are allowed for phrasing ("top 3", "two items").
 */
export function validateInterpretation(i: Interpretation, r: ToolResult): { ok: true } | { ok: false; reason: string } {
  const skus = new Set(r.rows.map((row) => String(row.sku ?? "")).filter(Boolean).map((s) => s.toLowerCase()));
  const unknown = i.cited_skus.filter((s) => !skus.has(s.toLowerCase()));
  if (unknown.length) return { ok: false, reason: `cited SKUs not in the data: ${unknown.join(", ")}` };
  const allowed = allowedNumbers(r);
  const text = [i.summary, ...i.points].join(" ");
  for (const m of text.matchAll(/(?<![A-Za-z-])-?\d[\d,]*\.?\d*/g)) {
    const raw = m[0].replace(/,/g, "").replace(/\.$/, "");
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) <= 10) continue;
    if (!allowed.has(String(n)) && !allowed.has(String(Math.round(n)))) return { ok: false, reason: `figure ${m[0]} does not appear in the data` };
  }
  return { ok: true };
}
