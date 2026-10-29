import { filterProducts } from "@/lib/analysis-view";
import { todayIn } from "@/lib/domain/dates";
import { toCsv } from "@/lib/domain/imports/values";
import { ANALYSIS_VIEWS, type AnalysisView } from "@/lib/queries";
import { fileResponse, withRoute } from "@/lib/route";
import { analyzeWorkspace } from "@/lib/services/analysis";
import { tx } from "@/lib/tenant";

export async function GET(req: Request) {
  return withRoute("view", "analysis.export", async (t) => {
    const sp = new URL(req.url).searchParams;
    const view = ((sp.get("view") ?? "all") in ANALYSIS_VIEWS ? sp.get("view") ?? "all" : "all") as AnalysisView;
    const windowDays = [30, 60, 90, 180].includes(Number(sp.get("window"))) ? Number(sp.get("window")) : t.business.settings.analysis.slowMovingDays;
    const a = await tx(t, (db) => analyzeWorkspace(db, t.businessId, t.business.settings.analysis, { timezone: t.business.timezone, windowDays }));
    const rows = filterProducts(a.products, {
      view,
      category: sp.get("category") || undefined,
      supplierId: sp.get("supplier") || undefined,
      minValue: Number(sp.get("minValue")) || undefined,
      lastSaleBefore: /^\d{4}-\d{2}-\d{2}$/.test(sp.get("lastSaleBefore") ?? "") ? sp.get("lastSaleBefore")! : undefined,
    });
    const csv = toCsv(
      ["SKU", "Product", "Category", "Supplier", "Unit", "In stock", "Unit cost", "Stock value", `Sold in ${windowDays} days`, "Last sale", "Avg daily sales", "Days of cover", "Excess qty", "Excess value", "Status", "Flags", "Rule", "Reorder point", "Suggested order", "Estimated cost", "Provisional", "Data quality"],
      rows.map((p) => [
        p.sku, p.name, p.category ?? "", p.supplierName ?? "", p.baseUnit, p.onHand, p.unitCost ?? "", p.movement.stockValue ?? "", p.qtySoldInWindow, p.lastSaleDate ?? "",
        p.demand.averageDailyDemand ?? "", p.movement.daysOfCover ?? "", p.movement.excessQty, p.movement.excessValue ?? "", p.movement.status,
        p.movement.flags.map((f) => f.label).join("; "), p.movement.flags.map((f) => f.rule).join(" | "), p.reorder.reorderPoint ?? "", p.reorder.suggestedQty,
        p.reorder.estimatedCost ?? "", p.reorder.provisional ? "yes" : "no", p.demand.quality,
      ]),
    );
    return fileResponse(csv, `stock-analysis-${view}-${todayIn(t.business.timezone)}.csv`, "text/csv; charset=utf-8");
  });
}
