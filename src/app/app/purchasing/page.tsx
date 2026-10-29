import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/client";
import { Alert, Badge, EmptyState, LinkButton, PageHeader, Panel } from "@/components/ui";
import { formatDate } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { loadAnalysis, loadEntitlements } from "@/lib/queries";
import type { ProductAnalysis } from "@/lib/services/analysis";
import { requireTenant } from "@/lib/tenant";
import { ConfidenceBadge, UrgencyBadge } from "../badges";
import { draftFromRecommendationsAction } from "./actions";

export const metadata: Metadata = { title: "Purchase list" };

const RANK: Record<string, number> = { out_of_stock: 0, critical: 1, reorder: 2, watch: 3, ok: 4, not_applicable: 5 };

export default async function PurchasingPage() {
  const t = await requireTenant();
  const ent = await loadEntitlements(t);
  const a = await loadAnalysis(t);
  const s = t.business.settings.analysis;

  if (!ent.features.reorder_engine) {
    const low = a.products.filter((p) => p.active && (p.onHand <= 0 || (p.reorder.method === "min_max" && p.reorder.suggestedQty > 0)));
    return (
      <>
        <PageHeader title="Purchase list" />
        <Alert tone="info" title="Reorder recommendations are part of the Growth plan">
          Your plan includes basic stock alerts. Upgrade to get demand-based quantities, supplier grouping and draft purchase orders. <Link href="/app/settings?tab=plan" className="font-medium underline">See plans</Link>
        </Alert>
        <Panel className="mt-6" title="Basic stock alerts" description="Out of stock, or below the minimum stock you set">
          <ul className="space-y-2 text-sm">
            {low.length === 0 && <li className="text-muted">No alerts.</li>}
            {low.map((p) => (
              <li key={p.id}>
                <Link href={`/app/inventory/${p.id}`} className="font-medium text-ink hover:text-signal">{p.name}</Link> <span className="text-muted">— {formatQty(p.onHand)} {p.baseUnit} in stock</span>
              </li>
            ))}
          </ul>
        </Panel>
      </>
    );
  }

  const recs = a.products.filter((p) => p.active && p.reorder.suggestedQty > 0).sort((x, y) => RANK[x.reorder.urgency] - RANK[y.reorder.urgency] || (x.reorder.daysOfStock ?? 0) - (y.reorder.daysOfStock ?? 0));
  const groups = new Map<string, { name: string | null; items: ProductAnalysis[] }>();
  for (const p of recs) {
    const key = p.supplierId ?? "none";
    const g = groups.get(key) ?? { name: p.supplierName, items: [] };
    g.items.push(p);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort(([ka], [kb]) => (ka === "none" ? 1 : kb === "none" ? -1 : 0));
  const total = recs.reduce((sum, p) => sum + (p.reorder.estimatedCost ?? 0), 0);
  const notAssessed = a.products.filter((p) => p.active && !p.reorder.eligible && p.onHand <= 0).length;

  return (
    <>
      <PageHeader
        title="Purchase list"
        description={
          recs.length
            ? `${recs.length} item(s) to review across ${groups.size} supplier group(s) · estimated ${formatINR(total, { whole: true })} at current prices`
            : "Nothing needs reordering right now."
        }
        actions={<LinkButton href="/app/purchase-orders" variant="secondary">Purchase orders</LinkButton>}
      />
      <Alert tone="neutral" className="mb-6">
        Suggestions use sales {a.salesCoverage.end ? `up to ${formatDate(a.salesCoverage.end)}` : "history once imported"}, a {s.targetCoverageDays}-day cover target and each supplier&apos;s lead time. Stock already on order (sent POs) is counted.
        Nothing is ordered until you create a PO, and StockPilot never sends it for you.
      </Alert>

      {recs.length === 0 ? (
        <EmptyState title="All stocked up" action={<LinkButton href="/app/analytics?view=all" variant="secondary">See all products</LinkButton>}>
          No item is at or below its reorder point.{notAssessed ? ` ${notAssessed} out-of-stock item(s) could not be assessed because they have no sales history or minimum stock.` : ""}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {ordered.map(([supplierId, g]) => {
            const groupTotal = g.items.reduce((sum, p) => sum + (p.reorder.estimatedCost ?? 0), 0);
            return (
              <Panel
                key={supplierId}
                title={g.name ?? "No supplier set"}
                description={supplierId === "none" ? "Set a preferred supplier on these products to include them in a purchase order." : `${g.items.length} item(s) · about ${formatINR(groupTotal, { whole: true })}`}
                bodyClassName="p-0"
              >
                <ActionForm action={draftFromRecommendationsAction}>
                  <input type="hidden" name="supplierId" value={supplierId === "none" ? "" : supplierId} />
                  <ul>
                    {g.items.map((p) => (
                      <li key={p.id} className="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:px-5">
                        <input type="checkbox" name={`pick_${p.id}`} defaultChecked={supplierId !== "none"} disabled={supplierId === "none"} aria-label={`Include ${p.name}`} className="mt-1 h-4 w-4 accent-signal" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/app/inventory/${p.id}`} className="font-medium text-ink hover:text-signal">{p.name}</Link>
                            <UrgencyBadge urgency={p.reorder.urgency} provisional={p.reorder.provisional} />
                            <ConfidenceBadge confidence={p.reorder.confidence} />
                            {p.demand.trend === "rising" && <Badge tone="info">Demand rising</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {p.sku} · {formatQty(p.onHand)} in stock{p.reorder.inbound ? ` · ${formatQty(p.reorder.inbound)} on order` : ""}
                            {p.reorder.daysOfStock !== null && p.onHand > 0 ? ` · about ${p.reorder.daysOfStock} days left` : ""} · {p.reorder.leadTimeDays}-day lead time
                            {p.demand.averageDailyDemand ? ` · sells ${formatQty(p.demand.averageDailyDemand)}/day` : ""}
                          </p>
                          <details className="mt-1.5 text-xs">
                            <summary className="cursor-pointer text-signal">Why this quantity?</summary>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                              {p.reorder.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                              {p.reorder.warnings.map((w) => (
                                <li key={w} className="text-warn">{w}</li>
                              ))}
                            </ul>
                          </details>
                        </div>
                        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                          <label className="flex items-center gap-2 text-sm">
                            <span className="text-muted">Order</span>
                            <input
                              name={`qty_${p.id}`}
                              defaultValue={p.reorder.suggestedQty}
                              inputMode="decimal"
                              aria-label={`Quantity of ${p.name} in ${p.baseUnit}`}
                              className="num h-9 w-24 rounded-md border border-line-strong bg-surface px-2 text-right"
                            />
                            <span className="text-muted">{p.baseUnit}</span>
                          </label>
                          <span className="num text-sm text-ink">{p.reorder.estimatedCost === null ? "No cost" : formatINR(p.reorder.estimatedCost, { whole: true })}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {supplierId !== "none" && (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                      <p className="text-xs text-muted">Creates a draft you can edit. Prices come from the supplier&apos;s recorded price or the product cost.</p>
                      <SubmitButton pendingLabel="Creating draft…">Create draft PO for {g.name}</SubmitButton>
                    </div>
                  )}
                </ActionForm>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
