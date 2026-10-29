import { describe, expect, it } from "vitest";
import { addDays, type ISODate } from "@/lib/domain/dates";
import { estimateDemand, estimateStockoutDays, type DemandStats } from "@/lib/domain/demand";
import { recommendReorder, type ReorderInput } from "@/lib/domain/reorder";

const END: ISODate = "2026-09-30";

function salesEveryDay(days: number, qty: number, end = END) {
  const m = new Map<ISODate, number>();
  for (let i = 0; i < days; i++) m.set(addDays(end, -i), qty);
  return m;
}

function demand(overrides: Partial<Parameters<typeof estimateDemand>[0]> = {}): DemandStats {
  return estimateDemand({
    dailySales: salesEveryDay(90, 2),
    coverageStart: addDays(END, -89),
    coverageEnd: END,
    stockoutDays: new Set(),
    lookbackDays: 90,
    minHistoryDays: 28,
    ...overrides,
  });
}

function input(overrides: Partial<ReorderInput> = {}): ReorderInput {
  return {
    active: true,
    onHand: 10,
    inbound: 0,
    reserved: 0,
    demand: demand(),
    leadTimeDays: 7,
    leadTimeSource: "supplier",
    safetyStock: 6,
    defaultSafetyDays: 3,
    minStock: null,
    maxStock: null,
    targetCoverageDays: 30,
    moq: null,
    packSize: null,
    unitCost: 125.5,
    ...overrides,
  };
}

describe("demand estimation", () => {
  it("computes a plain moving average over the window", () => {
    const d = demand();
    expect(d.observedDays).toBe(90);
    expect(d.totalQty).toBe(180);
    expect(d.averageDailyDemand).toBe(2);
    expect(d.quality).toBe("good");
    expect(d.trend).toBe("stable");
  });

  it("excludes stockout days from the denominator (censored demand)", () => {
    const sales = salesEveryDay(90, 2);
    const out = new Set<ISODate>();
    // 10 stockout days with zero sales
    for (let i = 0; i < 10; i++) {
      const d = addDays(END, -40 - i);
      out.add(d);
      sales.set(d, 0);
    }
    const d = demand({ dailySales: sales, stockoutDays: out });
    expect(d.inStockDays).toBe(80);
    expect(d.totalQty).toBe(160);
    expect(d.averageDailyDemand).toBe(2); // not 160/90
    expect(d.notes.join(" ")).toMatch(/Excluded 10 out-of-stock/);
  });

  it("marks heavy stockouts as limited quality", () => {
    const out = new Set<ISODate>();
    for (let i = 0; i < 30; i++) out.add(addDays(END, -i));
    expect(demand({ stockoutDays: out }).quality).toBe("limited");
  });

  it("returns 'none' with no sales data and 'insufficient' with short history", () => {
    expect(demand({ coverageStart: null, coverageEnd: null }).quality).toBe("none");
    const short = demand({ coverageStart: addDays(END, -9), dailySales: salesEveryDay(10, 1) });
    expect(short.quality).toBe("insufficient");
    expect(short.observedDays).toBe(10);
  });

  it("detects a rising trend", () => {
    const sales = new Map<ISODate, number>();
    for (let i = 0; i < 90; i++) sales.set(addDays(END, -i), i < 30 ? 4 : 1);
    const d = demand({ dailySales: sales });
    expect(d.trend).toBe("rising");
    expect(d.trendRatio).toBe(4);
  });

  it("applies the optional weighted adjustment only when enabled", () => {
    const sales = new Map<ISODate, number>();
    for (let i = 0; i < 90; i++) sales.set(addDays(END, -i), i < 30 ? 4 : 1);
    const plain = demand({ dailySales: sales });
    const weighted = demand({ dailySales: sales, useTrendAdjustment: true });
    expect(plain.averageDailyDemand).toBe(2); // (30*4 + 60*1)/90
    expect(weighted.averageDailyDemand).toBeCloseTo(0.6 * 4 + 0.4 * 2, 4);
  });

  it("does not count days before the product existed", () => {
    const d = demand({ productSince: addDays(END, -29) });
    expect(d.observedDays).toBe(30);
  });

  it("flags intermittent demand", () => {
    const sales = new Map<ISODate, number>([[addDays(END, -5), 10], [addDays(END, -50), 10], [addDays(END, -80), 10]]);
    const d = demand({ dailySales: sales });
    expect(d.intermittent).toBe(true);
    expect(d.averageDailyDemand).toBeCloseTo(30 / 90, 3);
  });
});

describe("stockout estimation from the ledger", () => {
  it("subtracts sales since the last count and resets at each count", () => {
    const movements = [
      { date: "2026-09-01", quantity: 10, resets: true },
      { date: "2026-09-20", quantity: 5, resets: true }, // count: 15 total balance
    ];
    const sales = new Map<ISODate, number>();
    for (let d = "2026-09-02"; d <= "2026-09-30"; d = addDays(d, 1)) sales.set(d, 1);
    const out = estimateStockoutDays({ movements, dailySales: sales, from: "2026-09-01", to: "2026-09-30" });
    // after 2026-09-01: 10 - 1/day → reaches 0 on 09-11, stays ≤0 until the 09-20 count resets to 15
    expect(out.has("2026-09-10")).toBe(false);
    expect(out.has("2026-09-11")).toBe(true);
    expect(out.has("2026-09-19")).toBe(true);
    expect(out.has("2026-09-20")).toBe(false);
    expect(out.has("2026-09-30")).toBe(false); // 15 - 10
  });

  it("never infers stockouts before the first movement", () => {
    const out = estimateStockoutDays({
      movements: [{ date: "2026-09-15", quantity: 3, resets: true }],
      dailySales: new Map(),
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect([...out].some((d) => d < "2026-09-15")).toBe(false);
  });
});

describe("reorder recommendation", () => {
  it("computes reorder point and suggested quantity with the documented formula", () => {
    const r = recommendReorder(input());
    // ROP = 2*7 + 6 = 20; target = 2*(7+30) + 6 = 80; position 10 → order 70
    expect(r.reorderPoint).toBe(20);
    expect(r.targetLevel).toBe(80);
    expect(r.suggestedQty).toBe(70);
    expect(r.estimatedCost).toBe(8785);
    expect(r.urgency).toBe("critical"); // 5 days of stock < 7 day lead time
    expect(r.daysOfStock).toBe(5);
    expect(r.confidence).toBe("high");
    expect(r.reasons.some((x) => x.includes("Reorder point"))).toBe(true);
  });

  it("counts inbound supply exactly once", () => {
    const r = recommendReorder(input({ inbound: 15 }));
    expect(r.inventoryPosition).toBe(25);
    // position 25 > ROP 20 → nothing to order, and inbound is not re-added anywhere else
    expect(r.suggestedQty).toBe(0);
    const r2 = recommendReorder(input({ inbound: 5 }));
    expect(r2.suggestedQty).toBe(65); // 80 - (10 + 5)
  });

  it("subtracts reserved stock", () => {
    const r = recommendReorder(input({ onHand: 30, reserved: 15 }));
    expect(r.inventoryPosition).toBe(15);
    expect(r.suggestedQty).toBe(65);
  });

  it("never recommends negative quantities", () => {
    const r = recommendReorder(input({ onHand: 500 }));
    expect(r.suggestedQty).toBe(0);
    expect(r.urgency).toBe("ok");
  });

  it("rounds up to MOQ and pack size", () => {
    expect(recommendReorder(input({ onHand: 75, moq: 50 })).suggestedQty).toBe(0); // above ROP
    expect(recommendReorder(input({ onHand: 18, moq: 100 })).suggestedQty).toBe(100);
    expect(recommendReorder(input({ onHand: 10, packSize: 12 })).suggestedQty).toBe(72);
  });

  it("caps target at max stock and honours min stock", () => {
    const r = recommendReorder(input({ maxStock: 50 }));
    expect(r.targetLevel).toBe(50);
    expect(r.suggestedQty).toBe(40);
    const r2 = recommendReorder(input({ onHand: 30, minStock: 40 }));
    expect(r2.reorderPoint).toBe(40);
    expect(r2.suggestedQty).toBe(50);
  });

  it("uses default safety days when safety stock is not set", () => {
    const r = recommendReorder(input({ safetyStock: null, defaultSafetyDays: 3 }));
    expect(r.safetyStock).toBe(6);
  });

  it("falls back to min/max when there is no history, labelled provisional", () => {
    const r = recommendReorder(input({ demand: demand({ coverageStart: null, coverageEnd: null }), minStock: 20, maxStock: 60, onHand: 5 }));
    expect(r.method).toBe("min_max");
    expect(r.provisional).toBe(true);
    expect(r.suggestedQty).toBe(55);
    expect(r.confidence).toBe("low");
  });

  it("is not eligible without history or min stock", () => {
    const r = recommendReorder(input({ demand: demand({ coverageStart: null, coverageEnd: null }) }));
    expect(r.eligible).toBe(false);
    expect(r.suggestedQty).toBe(0);
  });

  it("uses short history as provisional demand", () => {
    const short = demand({ coverageStart: addDays(END, -13), dailySales: salesEveryDay(14, 3) });
    const r = recommendReorder(input({ demand: short, onHand: 2 }));
    expect(r.method).toBe("provisional_demand");
    expect(r.provisional).toBe(true);
    expect(r.suggestedQty).toBeGreaterThan(0);
  });

  it("skips inactive products and zero-demand products above minimum", () => {
    expect(recommendReorder(input({ active: false })).eligible).toBe(false);
    const zero = demand({ dailySales: new Map() });
    const r = recommendReorder(input({ demand: zero, onHand: 5, safetyStock: 0 }));
    expect(r.averageDailyDemand).toBe(0);
    expect(r.suggestedQty).toBe(0);
  });

  it("marks out-of-stock items", () => {
    const r = recommendReorder(input({ onHand: 0 }));
    expect(r.urgency).toBe("out_of_stock");
    expect(r.suggestedQty).toBe(80);
  });

  it("warns when purchase cost is missing", () => {
    const r = recommendReorder(input({ unitCost: null }));
    expect(r.estimatedCost).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/No purchase cost/);
  });
});
