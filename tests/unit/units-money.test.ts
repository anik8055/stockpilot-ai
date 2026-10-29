import { describe, expect, it } from "vitest";
import { formatINR, formatINRCompact, lineTotal, money, sumMoney } from "@/lib/domain/money";
import { normalizeUnit, toBaseQuantity } from "@/lib/domain/units";
import { parseBusinessSettings } from "@/lib/domain/settings";

describe("unit conversion", () => {
  it("normalises unit spellings", () => {
    expect(normalizeUnit("Nos")).toBe("pcs");
    expect(normalizeUnit(" MTR ")).toBe("m");
    expect(normalizeUnit("Pkt")).toBe("pack");
    expect(normalizeUnit("")).toBeNull();
  });

  it("passes through the base unit", () => {
    expect(toBaseQuantity(5, "pcs", "pcs", [])).toEqual({ ok: true, baseQuantity: 5, factor: 1 });
    expect(toBaseQuantity(5, null, "pcs", [])).toEqual({ ok: true, baseQuantity: 5, factor: 1 });
  });

  it("converts only with an explicit conversion", () => {
    const conv = [{ unitCode: "box", factorToBase: 10 }];
    expect(toBaseQuantity(3, "Box", "pcs", conv)).toEqual({ ok: true, baseQuantity: 30, factor: 10 });
    const r = toBaseQuantity(3, "kg", "pcs", conv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/No conversion configured/);
  });

  it("does not treat metres and coils as interchangeable", () => {
    expect(toBaseQuantity(2, "coil", "m", []).ok).toBe(false);
    expect(toBaseQuantity(2, "coil", "m", [{ unitCode: "coil", factorToBase: 90 }])).toMatchObject({ ok: true, baseQuantity: 180 });
  });
});

describe("money", () => {
  it("rounds half-up per line before summing", () => {
    expect(money("2.345").toString()).toBe("2.35");
    expect(lineTotal(3, "33.335").toString()).toBe("100.01");
    expect(sumMoney(["0.105", "0.105"]).toString()).toBe("0.22"); // 0.11 + 0.11, not round(0.21)
  });

  it("formats INR with Indian grouping", () => {
    expect(formatINR(123456.5)).toBe("₹1,23,456.50");
    expect(formatINRCompact(1250000)).toBe("₹12.50 L");
    expect(formatINRCompact(32000000)).toBe("₹3.20 Cr");
  });
});

describe("business settings", () => {
  it("fills defaults and drops invalid values", () => {
    const s = parseBusinessSettings({ analysis: { targetCoverageDays: 45, demandLookbackDays: -5 } });
    expect(s.analysis.targetCoverageDays).toBe(45);
    expect(s.analysis.demandLookbackDays).toBe(90);
    expect(parseBusinessSettings(null).analysis.slowMovingDays).toBe(90);
  });
});
