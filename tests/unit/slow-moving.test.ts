import { describe, expect, it } from "vitest";
import { classifyMovement, findPossibleDuplicates, percentile, suspiciousCostChange, type MovementInput } from "@/lib/domain/slow-moving";

const base: MovementInput = {
  onHand: 40,
  unitCost: 100,
  qtySoldInWindow: 0,
  lastSaleDate: null,
  averageDailyDemand: 0,
  coverageStart: "2026-01-01",
  coverageEnd: "2026-09-30",
  productSince: null,
  windowDays: 90,
  slowVelocityPerMonth: 1,
  excessCoverageDays: 120,
  highValueThreshold: null,
};

describe("slow-moving classification", () => {
  it("confirms non-moving stock only when history covers the window", () => {
    const r = classifyMovement(base);
    expect(r.status).toBe("non_moving");
    expect(r.excessValue).toBe(4000);
    expect(r.flags[0].rule).toMatch(/2026-07-03 and 2026-09-30/);
  });

  it("says 'no recorded sales' when history is shorter than the window", () => {
    const r = classifyMovement({ ...base, coverageStart: "2026-08-15" });
    expect(r.status).toBe("no_recorded_sales");
    expect(r.flags[0].code).toBe("no_recorded_sales");
    expect(r.excessQty).toBe(0);
  });

  it("does not call a product added recently dead stock", () => {
    const r = classifyMovement({ ...base, productSince: "2026-09-01" });
    expect(r.status).toBe("no_recorded_sales");
  });

  it("returns unknown when no sales data exists at all", () => {
    const r = classifyMovement({ ...base, coverageStart: null, coverageEnd: null });
    expect(r.status).toBe("unknown");
    expect(r.flags[0].code).toBe("no_sales_data");
  });

  it("flags slow movers by velocity", () => {
    const r = classifyMovement({ ...base, qtySoldInWindow: 2, averageDailyDemand: 2 / 90 });
    expect(r.status).toBe("slow");
    expect(r.velocityPerMonth).toBeCloseTo(0.67, 2);
  });

  it("computes excess over the coverage limit", () => {
    const r = classifyMovement({ ...base, onHand: 400, qtySoldInWindow: 180, averageDailyDemand: 2 });
    expect(r.status).toBe("moving");
    expect(r.excessQty).toBe(160); // 400 - 2*120
    expect(r.excessValue).toBe(16000);
    expect(r.flags.map((f) => f.code)).toContain("excess");
  });

  it("flags high-value slow stock against a threshold", () => {
    const r = classifyMovement({ ...base, highValueThreshold: 3000 });
    expect(r.flags.map((f) => f.code)).toContain("high_value_slow");
  });

  it("ignores items without stock", () => {
    expect(classifyMovement({ ...base, onHand: 0 }).status).toBe("no_stock");
  });

  it("percentile needs enough values", () => {
    expect(percentile([1, 2, 3], 0.9)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(10);
  });
});

describe("data quality checks", () => {
  it("finds duplicate descriptions regardless of case, spacing and word order", () => {
    const d = findPossibleDuplicates([
      { id: "a", sku: "W1", name: "Copper Wire 2.5 sqmm Red", barcode: null, mpn: null, brand: null },
      { id: "b", sku: "W2", name: "copper wire red 2.5sqmm", barcode: null, mpn: null, brand: null },
      { id: "c", sku: "W3", name: "Copper Wire 4 sqmm Red", barcode: null, mpn: null, brand: null },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].productIds.sort()).toEqual(["a", "b"]);
  });

  it("finds duplicate manufacturer part numbers", () => {
    const d = findPossibleDuplicates([
      { id: "a", sku: "B1", name: "Brake pad front", barcode: null, mpn: "BP-1234", brand: "Bosch" },
      { id: "b", sku: "B2", name: "Front brake pads set", barcode: null, mpn: "bp1234", brand: "BOSCH" },
    ]);
    expect(d[0].reason).toMatch(/part number/);
  });

  it("flags large purchase cost changes", () => {
    expect(suspiciousCostChange([100, 102, 98, 160])?.changePct).toBe(60);
    expect(suspiciousCostChange([100, 102, 98, 105])).toBeNull();
    expect(suspiciousCostChange([100, 200])).toBeNull();
  });
});
