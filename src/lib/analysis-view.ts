import type { ProductAnalysis } from "@/lib/services/analysis";
import { isLowStock } from "@/lib/services/analysis";
import type { AnalysisView } from "@/lib/queries";

export type ViewFilters = {
  view: AnalysisView;
  category?: string;
  supplierId?: string;
  minValue?: number;
  /** Only items whose last sale is before this date (or never sold). */
  lastSaleBefore?: string;
  sort?: "value" | "name" | "cover" | "last_sale" | "urgency";
};

const URGENCY_RANK: Record<string, number> = { out_of_stock: 0, critical: 1, reorder: 2, watch: 3, ok: 4, not_applicable: 5 };

export function filterProducts(products: ProductAnalysis[], f: ViewFilters): ProductAnalysis[] {
  let rows = products.filter((p) => p.active);
  switch (f.view) {
    case "low":
      rows = rows.filter(isLowStock);
      break;
    case "out":
      rows = rows.filter((p) => p.onHand <= 0);
      break;
    case "reorder":
      rows = rows.filter((p) => p.reorder.suggestedQty > 0);
      break;
    case "excess":
      rows = rows.filter((p) => p.movement.flags.some((x) => x.code === "excess" || x.code === "non_moving"));
      break;
    case "non_moving":
      rows = rows.filter((p) => p.movement.status === "non_moving");
      break;
    case "no_sales":
      rows = rows.filter((p) => p.movement.status === "no_recorded_sales");
      break;
    case "slow":
      rows = rows.filter((p) => p.movement.status === "slow");
      break;
    case "stockouts":
      rows = rows.filter((p) => p.recentStockoutDays > 0);
      break;
    case "high_value":
      rows = rows.filter((p) => p.movement.flags.some((x) => x.code === "high_value_slow"));
      break;
    case "cost_jumps":
      rows = rows.filter((p) => p.costChange !== null);
      break;
  }
  if (f.category) rows = rows.filter((p) => p.category === f.category);
  if (f.supplierId) rows = rows.filter((p) => p.supplierId === f.supplierId);
  if (f.minValue && f.minValue > 0) rows = rows.filter((p) => (p.movement.stockValue ?? 0) >= f.minValue!);
  if (f.lastSaleBefore) rows = rows.filter((p) => !p.lastSaleDate || p.lastSaleDate < f.lastSaleBefore!);

  const sort = f.sort ?? (f.view === "low" || f.view === "out" || f.view === "reorder" ? "urgency" : "value");
  const val = (p: ProductAnalysis) => (f.view === "excess" ? (p.movement.excessValue ?? 0) : (p.movement.stockValue ?? 0));
  return [...rows].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name);
      case "cover":
        return (b.movement.daysOfCover ?? -1) - (a.movement.daysOfCover ?? -1);
      case "last_sale":
        return (a.lastSaleDate ?? "").localeCompare(b.lastSaleDate ?? "");
      case "urgency":
        return URGENCY_RANK[a.reorder.urgency] - URGENCY_RANK[b.reorder.urgency] || (a.reorder.daysOfStock ?? 0) - (b.reorder.daysOfStock ?? 0);
      default:
        return val(b) - val(a);
    }
  });
}
