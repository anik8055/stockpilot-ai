/* Dev helper: prints the analysis for the first demo workspace. */
import { loadEnvFiles } from "./load-env";
loadEnvFiles();
async function main() {
  const { withAdmin, withTenant, closePools } = await import("@/lib/db");
  const { analyzeWorkspace, dashboardMetrics } = await import("@/lib/services/analysis");
  const { parseBusinessSettings } = await import("@/lib/domain/settings");
  const b = await withAdmin((tx) => tx.one<{ id: string; uid: string }>("SELECT b.id, m.user_id AS uid FROM businesses b JOIN memberships m ON m.business_id=b.id WHERE is_demo LIMIT 1"));
  const t0 = Date.now();
  const a = await withTenant({ userId: b.uid, businessId: b.id }, (tx) => analyzeWorkspace(tx, b.id, parseBusinessSettings({}).analysis, { timezone: "Asia/Kolkata" }));
  console.log("ms", Date.now() - t0, "coverage", a.salesCoverage, "snapshot", a.lastSnapshotAt);
  console.log(dashboardMetrics(a));
  const by = (k: (p: (typeof a.products)[number]) => string) => a.products.reduce<Record<string, number>>((m, p) => ((m[k(p)] = (m[k(p)] ?? 0) + 1), m), {});
  console.log("urgency", by((p) => p.reorder.urgency), "method", by((p) => p.reorder.method), "quality", by((p) => p.demand.quality), "movement", by((p) => p.movement.status));
  for (const p of a.products.filter((p) => p.reorder.suggestedQty > 0).slice(0, 4)) console.log(p.sku, p.onHand, p.reorder.suggestedQty, p.reorder.estimatedCost, p.reorder.urgency, "\n  ", p.reorder.reasons.join("\n   "));
  console.log("dups", a.duplicates, "costJumps", a.products.filter((p) => p.costChange).map((p) => [p.sku, p.costChange]));
  await closePools();
}
main();
