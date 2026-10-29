import type { Metadata } from "next";
import Link from "next/link";
import { MonthlySalesChart } from "@/components/charts";
import { Alert, LinkButton, Metric, PageHeader, Panel } from "@/components/ui";
import { diffDays, formatDate } from "@/lib/domain/dates";
import { formatINR, formatINRCompact, formatQty } from "@/lib/domain/money";
import { loadAnalysis, loadEntitlements } from "@/lib/queries";
import { dashboardMetrics, monthlySalesTrend } from "@/lib/services/analysis";
import { requireTenant, tx } from "@/lib/tenant";
import { UrgencyBadge } from "../badges";
import { GettingStarted } from "../getting-started";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const t = await requireTenant();
  const [a, ent] = [await loadAnalysis(t), await loadEntitlements(t)];
  const s = t.business.settings.analysis;

  if (a.products.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Your stock position will appear here once you import your data." />
        <GettingStarted step={0} />
      </>
    );
  }

  const m = dashboardMetrics(a);
  const trend = await tx(t, (db) => monthlySalesTrend(db, t.businessId, 6));
  const fullMonths = trend.filter((r) => r.days >= 20);
  const showTrend = fullMonths.length >= 2;
  const range = a.salesCoverage.start ? `${formatDate(a.salesCoverage.start)} – ${formatDate(a.salesCoverage.end)}` : null;
  const salesAge = a.salesCoverage.end ? diffDays(a.salesCoverage.end, a.asOf) : null;
  const snapshotAge = a.lastSnapshotAt ? diffDays(a.lastSnapshotAt, a.asOf) : null;
  const windowLabel = `${a.windowDays} days to ${formatDate(a.salesCoverage.end)}`;

  const urgent = a.products
    .filter((p) => p.active && p.reorder.suggestedQty > 0)
    .sort((x, y) => rank(x.reorder.urgency) - rank(y.reorder.urgency) || (x.reorder.daysOfStock ?? 0) - (y.reorder.daysOfStock ?? 0))
    .slice(0, 8);
  const stuck = a.products
    .filter((p) => p.active && (p.movement.excessValue ?? 0) > 0)
    .sort((x, y) => (y.movement.excessValue ?? 0) - (x.movement.excessValue ?? 0))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          <>
            Stock as on {a.lastSnapshotAt ? formatDate(a.lastSnapshotAt) : "your last update"}
            {range ? <> · sales data {range}</> : <> · no sales history imported yet</>}
          </>
        }
        actions={
          <>
            <LinkButton href="/app/imports/new" variant="secondary">Import data</LinkButton>
            {ent.features.reorder_engine && <LinkButton href="/app/purchasing">Open purchase list</LinkButton>}
          </>
        }
      />

      {!a.salesCoverage.end && (
        <Alert tone="warn" title="Import your sales history to unlock demand-based advice" className="mb-6">
          Without item-wise sales, StockPilot can only use your minimum stock levels. <Link href="/app/imports/new?kind=sales" className="font-medium underline">Import sales</Link>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active products" value={m.activeSkus.toLocaleString("en-IN")} sub={`${formatQty(m.unitsOnHand)} units in stock`} href="/app/inventory" definition="Products marked active. Units in stock is the sum of positive stock balances across all active products (each in its own unit)." />
        <Metric
          label="Stock value at cost"
          value={formatINRCompact(m.inventoryValue)}
          sub={m.itemsMissingCost ? `${m.itemsMissingCost} item(s) have no cost and are excluded` : "Current stock × purchase cost"}
          href="/app/analytics?view=all&sort=value"
          definition="Σ (stock on hand × unit cost) for active products with positive stock. Unit cost is the preferred supplier's price, or the product's purchase cost when no supplier price is recorded."
        />
        <Metric label="Low stock" tone={m.lowStock ? "warn" : "neutral"} value={m.lowStock} sub="At or below reorder point" href="/app/analytics?view=low" definition="In stock, but stock + incoming orders is at or below the reorder point (average daily sales × lead time + safety stock, or minimum stock if higher)." />
        <Metric label="Out of stock" tone={m.outOfStock ? "danger" : "neutral"} value={m.outOfStock} sub="Zero or negative stock" href="/app/analytics?view=out" definition="Active products whose recorded stock is zero or less." />
        <Metric
          label="Excess stock value"
          tone={m.excessValue ? "warn" : "neutral"}
          value={formatINRCompact(m.excessValue)}
          sub={`${m.excessSkus} product(s) · ${windowLabel}`}
          href="/app/analytics?view=excess"
          definition={`Value of stock beyond ${s.excessCoverageDays} days of sales at the current rate, plus all stock of confirmed non-moving items. Valued at cost.`}
        />
        <Metric
          label="Non-moving stock"
          tone={m.nonMoving ? "warn" : "neutral"}
          value={m.nonMoving}
          sub={`${formatINRCompact(m.nonMovingValue)} at cost${m.noRecordedSales ? ` · ${m.noRecordedSales} more with too little history` : ""}`}
          href="/app/analytics?view=non_moving"
          definition={`In stock with no sales in the last ${a.windowDays} days, where imported sales history covers that whole period. Items with shorter history are counted separately as "no recorded sales".`}
        />
        <Metric label="Slow-moving" value={m.slowMoving} sub={`Below ${s.slowVelocityPerMonth}/month · ${windowLabel}`} href="/app/analytics?view=slow" definition={`Sold at least once, but fewer than ${s.slowVelocityPerMonth} unit(s) per 30 days over the last ${a.windowDays} days of sales data.`} />
        <Metric
          label="Recent stockouts"
          tone={m.recentStockouts ? "warn" : "neutral"}
          value={m.recentStockouts}
          sub="Out of stock on some day in the last 30 days of data"
          href="/app/analytics?view=stockouts"
          definition="Estimated from stock counts, receipts and recorded sales: days when stock had run out and nothing was sold. Lost sales on those days are not counted as demand."
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Order soon"
          description={ent.features.reorder_engine ? `${m.recommendations} item(s) to review · est. ${formatINR(m.recommendationValue, { whole: true })}${m.provisionalRecommendations ? ` · ${m.provisionalRecommendations} provisional` : ""}` : "Low and out-of-stock items"}
          actions={ent.features.reorder_engine ? <Link href="/app/purchasing" className="text-sm font-medium text-signal hover:underline">View purchase list</Link> : undefined}
          bodyClassName="p-0"
        >
          {urgent.length === 0 ? (
            <p className="p-5 text-sm text-muted">Nothing needs reordering right now.</p>
          ) : (
            <ul>
              {urgent.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 last:border-0 sm:px-5">
                  <div className="min-w-0">
                    <Link href={`/app/inventory/${p.id}`} className="font-medium text-ink hover:text-signal">{p.name}</Link>
                    <p className="text-xs text-muted">
                      {p.sku} · {formatQty(p.onHand)} {p.baseUnit} in stock
                      {p.reorder.daysOfStock !== null && p.onHand > 0 && <> · about {p.reorder.daysOfStock} days left</>}
                      {p.reorder.inbound > 0 && <> · {formatQty(p.reorder.inbound)} on order</>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <UrgencyBadge urgency={p.reorder.urgency} provisional={p.reorder.provisional} />
                    {ent.features.reorder_engine && (
                      <p className="num mt-1 text-sm text-ink">
                        Order {formatQty(p.reorder.suggestedQty)} {p.baseUnit}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Money stuck in stock" description={`Excess and non-moving stock · ${windowLabel}`} actions={<Link href="/app/analytics?view=excess" className="text-sm font-medium text-signal hover:underline">See all</Link>} bodyClassName="p-0">
          {stuck.length === 0 ? (
            <p className="p-5 text-sm text-muted">{a.salesCoverage.end ? "No excess or non-moving stock found." : "Needs sales history to assess."}</p>
          ) : (
            <ul>
              {stuck.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 last:border-0 sm:px-5">
                  <div className="min-w-0">
                    <Link href={`/app/inventory/${p.id}`} className="font-medium text-ink hover:text-signal">{p.name}</Link>
                    <p className="text-xs text-muted">
                      {p.movement.status === "non_moving" ? `No sales in ${a.windowDays} days` : `~${p.movement.daysOfCover} days of cover`} · {formatQty(p.onHand)} {p.baseUnit}
                    </p>
                  </div>
                  <p className="num shrink-0 font-semibold text-ink">{formatINR(p.movement.excessValue, { whole: true })}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Monthly sales value" description={showTrend ? "From imported sales history. The latest month may be incomplete." : undefined}>
          {showTrend ? (
            <MonthlySalesChart data={trend.map((r) => ({ label: new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), value: Number(r.value ?? 0), partial: r.days < 20 }))} />
          ) : (
            <p className="text-sm text-muted">A trend appears once at least two full months of sales history have been imported.</p>
          )}
        </Panel>
        <Panel title="Data health" description="Fix these at the source for better advice">
          <ul className="space-y-2.5 text-sm">
            <Health ok={salesAge !== null && salesAge <= 14} label={salesAge === null ? "No sales history imported" : `Sales data last covers ${formatDate(a.salesCoverage.end)} (${salesAge} day${salesAge === 1 ? "" : "s"} ago)`} href="/app/imports/new?kind=sales" />
            <Health ok={snapshotAge !== null && snapshotAge <= 31} label={snapshotAge === null ? "No stock count imported" : `Last stock count ${formatDate(a.lastSnapshotAt)} (${snapshotAge} day${snapshotAge === 1 ? "" : "s"} ago)`} href="/app/imports/new?kind=stock_snapshot" />
            <Health ok={m.itemsMissingCost === 0} label={m.itemsMissingCost ? `${m.itemsMissingCost} in-stock item(s) without a purchase cost` : "Every in-stock item has a cost"} href="/app/inventory" />
            <Health ok={m.negativeStock === 0} label={m.negativeStock ? `${m.negativeStock} item(s) with negative stock` : "No negative stock"} href="/app/analytics?view=out" />
            <Health ok={m.duplicateGroups === 0} label={m.duplicateGroups ? `${m.duplicateGroups} possible duplicate product group(s)` : "No duplicate descriptions found"} href="/app/analytics?view=all#duplicates" />
            <Health ok={m.costJumps === 0} label={m.costJumps ? `${m.costJumps} item(s) with a purchase cost jump of 40% or more` : "No unusual purchase cost changes"} href="/app/analytics?view=cost_jumps" />
          </ul>
        </Panel>
      </div>
    </>
  );
}

function rank(u: string) {
  return { out_of_stock: 0, critical: 1, reorder: 2, watch: 3, ok: 4, not_applicable: 5 }[u] ?? 9;
}

function Health({ ok, label, href }: { ok: boolean; label: string; href: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-ok" : "bg-warn"}`} aria-hidden />
      <span className="flex-1">
        <span className="sr-only">{ok ? "OK: " : "Needs attention: "}</span>
        {ok ? label : <Link href={href} className="text-ink underline decoration-line-strong underline-offset-2 hover:text-signal">{label}</Link>}
      </span>
    </li>
  );
}
