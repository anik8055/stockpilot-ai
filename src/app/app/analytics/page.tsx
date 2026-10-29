import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, EmptyState, Input, PageHeader, Panel, Select, Table, Td, Th } from "@/components/ui";
import { filterProducts } from "@/lib/analysis-view";
import { formatDate } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { ANALYSIS_VIEWS, loadAnalysis, type AnalysisView } from "@/lib/queries";
import { productFacets } from "@/lib/services/catalog";
import { requireTenant, tx } from "@/lib/tenant";
import { UrgencyBadge } from "../badges";

export const metadata: Metadata = { title: "Stock analysis" };

const WINDOWS = [30, 60, 90, 180];
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function AnalyticsPage(props: PageProps<"/app/analytics">) {
  const t = await requireTenant();
  const sp = await props.searchParams;
  const view = (str(sp.view) && str(sp.view)! in ANALYSIS_VIEWS ? str(sp.view) : "all") as AnalysisView;
  const windowDays = WINDOWS.includes(Number(str(sp.window))) ? Number(str(sp.window)) : t.business.settings.analysis.slowMovingDays;
  const filters = {
    view,
    category: str(sp.category) || undefined,
    supplierId: str(sp.supplier) || undefined,
    minValue: Number(str(sp.minValue)) || undefined,
    lastSaleBefore: /^\d{4}-\d{2}-\d{2}$/.test(str(sp.lastSaleBefore) ?? "") ? str(sp.lastSaleBefore) : undefined,
    sort: (["value", "name", "cover", "last_sale", "urgency"].includes(str(sp.sort) ?? "") ? str(sp.sort) : undefined) as "value" | undefined,
  };
  const a = await loadAnalysis(t, windowDays);
  const facets = await tx(t, (db) => productFacets(db, t.businessId));
  const rows = filterProducts(a.products, filters);
  const shown = rows.slice(0, 300);
  const totalValue = rows.reduce((s, p) => s + (view === "excess" || view === "non_moving" ? (p.movement.excessValue ?? 0) : (p.movement.stockValue ?? 0)), 0);
  const qs = new URLSearchParams(Object.entries({ view, window: String(windowDays), category: filters.category, supplier: filters.supplierId, minValue: filters.minValue ? String(filters.minValue) : undefined, lastSaleBefore: filters.lastSaleBefore }).filter(([, v]) => v) as [string, string][]);
  const byId = new Map(a.products.map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        title="Stock analysis"
        description={a.salesCoverage.end ? `Movement measured over ${windowDays} days of sales data ending ${formatDate(a.salesCoverage.end)}.` : "Import sales history to measure how fast items move."}
        actions={<a href={`/api/analysis/export?${qs}`} className={buttonClass("secondary")}>Export CSV</a>}
      />

      <nav aria-label="Views" className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {(Object.keys(ANALYSIS_VIEWS) as AnalysisView[]).map((v) => {
          const n = filterProducts(a.products, { view: v }).length;
          const q = new URLSearchParams(qs);
          q.set("view", v);
          return (
            <Link key={v} href={`?${q}`} aria-current={v === view ? "page" : undefined} className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${v === view ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-paper"}`}>
              {ANALYSIS_VIEWS[v]} <span className={v === view ? "text-[#c9d6ea]" : "text-muted"}>{n}</span>
            </Link>
          );
        })}
      </nav>

      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <input type="hidden" name="view" value={view} />
        <label className="sr-only" htmlFor="window">Window</label>
        <Select id="window" name="window" defaultValue={String(windowDays)}>
          {WINDOWS.map((w) => (
            <option key={w} value={w}>Last {w} days</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="category">Category</label>
        <Select id="category" name="category" defaultValue={filters.category ?? ""}>
          <option value="">All categories</option>
          {facets.categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="supplier">Supplier</label>
        <Select id="supplier" name="supplier" defaultValue={filters.supplierId ?? ""}>
          <option value="">All suppliers</option>
          {facets.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="minValue">Minimum stock value</label>
        <Input id="minValue" name="minValue" inputMode="numeric" placeholder="Min. stock value ₹" defaultValue={filters.minValue ?? ""} />
        <label className="sr-only" htmlFor="lastSaleBefore">Last sale before</label>
        <Input id="lastSaleBefore" name="lastSaleBefore" type="date" title="Last sale before" defaultValue={filters.lastSaleBefore ?? ""} />
        <button className={buttonClass("secondary")} type="submit">Apply</button>
      </form>

      <Panel
        title={`${ANALYSIS_VIEWS[view]} · ${rows.length} product${rows.length === 1 ? "" : "s"}`}
        description={rows.length ? `${view === "excess" || view === "non_moving" ? "Excess value" : "Stock value"} ${formatINR(totalValue, { whole: true })} at cost${rows.length > shown.length ? ` · showing first ${shown.length} — export for all` : ""}` : undefined}
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Nothing in this view">{!a.salesCoverage.end && view !== "out" ? "Most views need imported sales history." : "Try a different window or clear the filters."}</EmptyState>
          </div>
        ) : (
          <Table minWidth={980}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th align="right">In stock</Th>
                <Th align="right">Stock value</Th>
                <Th align="right">Sold ({windowDays}d)</Th>
                <Th>Last sale</Th>
                <Th align="right">Days of cover</Th>
                <Th>Status and rule</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="hover:bg-paper/60">
                  <Td>
                    <Link href={`/app/inventory/${p.id}`} className="font-medium text-ink hover:text-signal">{p.name}</Link>
                    <span className="block text-xs text-muted">
                      {p.sku}
                      {p.supplierName ? ` · ${p.supplierName}` : ""}
                    </span>
                  </Td>
                  <Td align="right" className={p.onHand <= 0 ? "text-danger" : ""}>
                    {formatQty(p.onHand)} <span className="text-xs text-muted">{p.baseUnit}</span>
                  </Td>
                  <Td align="right">
                    {p.movement.stockValue === null ? "—" : formatINR(p.movement.stockValue, { whole: true })}
                    {p.movement.excessValue ? <span className="block text-xs text-warn">{formatINR(p.movement.excessValue, { whole: true })} excess</span> : null}
                  </Td>
                  <Td align="right">{formatQty(p.qtySoldInWindow)}</Td>
                  <Td className="whitespace-nowrap">{p.lastSaleDate ? formatDate(p.lastSaleDate) : <span className="text-muted">No recorded sale</span>}</Td>
                  <Td align="right">{p.movement.daysOfCover ?? "—"}</Td>
                  <Td className="max-w-md">
                    <div className="flex flex-wrap gap-1">
                      {(view === "low" || view === "out" || view === "reorder" || view === "stockouts") && <UrgencyBadge urgency={p.reorder.urgency} provisional={p.reorder.provisional} />}
                      {p.movement.flags.map((f) => (
                        <Badge key={f.code} tone={f.severity === "high" ? "danger" : f.severity === "medium" ? "warn" : "neutral"}>{f.label}</Badge>
                      ))}
                      {p.recentStockoutDays > 0 && <Badge tone="warn">Out of stock {p.recentStockoutDays}d of last 30</Badge>}
                      {p.costChange && <Badge tone="warn">Cost {p.costChange.changePct > 0 ? "+" : ""}{p.costChange.changePct}%</Badge>}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      {view === "cost_jumps" && p.costChange
                        ? `Latest purchase cost ${formatINR(p.costChange.latest)} vs usual ${formatINR(p.costChange.median)} (median of earlier purchases).`
                        : view === "low" || view === "reorder" || view === "out"
                          ? p.reorder.reasons.slice(0, 2).join(" ")
                          : (p.movement.flags[0]?.rule ?? (p.recentStockoutDays ? "Estimated from stock counts, receipts and recorded sales." : ""))}
                    </p>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {a.duplicates.length > 0 && (
        <Panel className="mt-6" title="Possible duplicate products" description="Same item entered twice inflates stock counts and splits sales history. Merge them in your billing system, then archive the extra one here.">
          <ul id="duplicates" className="space-y-3 text-sm">
            {a.duplicates.map((d, i) => (
              <li key={i}>
                <p className="text-muted">{d.reason}</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {d.productIds.map((id) => {
                    const p = byId.get(id);
                    return p ? (
                      <li key={id}>
                        <Link href={`/app/inventory/${id}`} className="rounded border border-line px-2 py-1 hover:bg-paper">
                          {p.sku} — {p.name}
                        </Link>
                      </li>
                    ) : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
