import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePools, withAdmin, withTenant } from "@/lib/db";
import { addDays, todayIn } from "@/lib/domain/dates";
import { parseBusinessSettings } from "@/lib/domain/settings";
import { analyzeWorkspace, dashboardMetrics } from "@/lib/services/analysis";
import { seedDemoData } from "@/lib/services/demo";
import { buildWeeklyReport, getReport, reportCsv, reportPdf, saveReport } from "@/lib/services/reports";
import { createBusiness } from "@/lib/services/workspaces";
import { resetTestDatabase } from "./db";

let ctx: { userId: string; businessId: string };
const settings = parseBusinessSettings({}).analysis;
const today = todayIn("Asia/Kolkata");

beforeAll(async () => {
  await resetTestDatabase();
  const u = await withAdmin((tx) => tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ('rep@test.local', 'Rep', 'x') RETURNING id"));
  const b = await createBusiness(u.id, { name: "Report Test Traders", industry: "electrical" });
  await withAdmin((tx) => seedDemoData(tx, b.id, u.id, today));
  ctx = { userId: u.id, businessId: b.id };
});

afterAll(closePools);

describe("weekly report", () => {
  it("totals match the underlying records", async () => {
    const period = { start: addDays(today, -7), end: addDays(today, -1) };
    const r = await withTenant(ctx, (tx) => buildWeeklyReport(tx, ctx.businessId, settings, "Asia/Kolkata", period));
    const sql = await withTenant(ctx, (tx) =>
      tx.one<{ v: string; q: string; n: number }>("SELECT sum(line_total) AS v, sum(quantity) AS q, count(*)::int AS n FROM sales_lines WHERE sold_on BETWEEN $1 AND $2", [period.start, period.end]),
    );
    expect(r.sales.current.value).toBeCloseTo(Number(sql.v), 2);
    expect(r.sales.current.qty).toBeCloseTo(Number(sql.q), 3);
    expect(r.sales.current.lines).toBe(sql.n);

    const a = await withTenant(ctx, (tx) => analyzeWorkspace(tx, ctx.businessId, settings, { timezone: "Asia/Kolkata" }));
    const m = dashboardMetrics(a);
    expect(r.metrics.inventoryValue).toBe(m.inventoryValue);
    expect(r.reorderTotal.items).toBe(a.products.filter((p) => p.active && p.reorder.suggestedQty > 0).length);
    const recValue = a.products.filter((p) => p.active && p.reorder.suggestedQty > 0).reduce((s, p) => s + (p.reorder.estimatedCost ?? 0), 0);
    expect(r.reorderTotal.value).toBeCloseTo(recValue, 2);
    // supplier groups add up to the reorder total
    expect(r.suppliers.reduce((s, g) => s + g.value, 0)).toBeCloseTo(r.reorderTotal.value, 1);
    expect(r.suppliers.reduce((s, g) => s + g.items, 0)).toBe(r.reorderTotal.items);
    expect(r.previous).toEqual({ start: addDays(today, -14), end: addDays(today, -8) });
    expect(r.sales.comparable).toBe(true);
    expect(r.assumptions.length).toBeGreaterThan(3);
  });

  it("does not compare periods when history does not cover the previous one", async () => {
    const r = await withTenant(ctx, (tx) => buildWeeklyReport(tx, ctx.businessId, settings, "Asia/Kolkata", { start: addDays(today, -185), end: addDays(today, -179) }));
    expect(r.sales.comparable).toBe(false);
    expect(r.sales.changePct).toBeNull();
  });

  it("saves, reloads, exports CSV and PDF", async () => {
    const data = await withTenant(ctx, (tx) => buildWeeklyReport(tx, ctx.businessId, settings, "Asia/Kolkata", { start: addDays(today, -7), end: addDays(today, -1) }));
    const id = await withTenant(ctx, (tx) => saveReport(tx, ctx, data));
    const back = await withTenant(ctx, (tx) => getReport(tx, ctx.businessId, id));
    expect(back.data.reorderTotal).toEqual(data.reorderTotal);
    const csv = reportCsv(back.data, "reorder");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(data.reorder.length + 1);
    const pdf = await reportPdf(back.data);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("rejects invalid periods", async () => {
    await expect(withTenant(ctx, (tx) => buildWeeklyReport(tx, ctx.businessId, settings, "Asia/Kolkata", { start: today, end: addDays(today, -3) }))).rejects.toThrow(/end date/);
    await expect(withTenant(ctx, (tx) => buildWeeklyReport(tx, ctx.businessId, settings, "Asia/Kolkata", { start: addDays(today, -200), end: today }))).rejects.toThrow(/92 days/);
  });
});
