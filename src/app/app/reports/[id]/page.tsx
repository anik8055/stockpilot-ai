import type { Metadata } from "next";
import Link from "next/link";
import { Alert, buttonClass, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { getReport, type ReportItem } from "@/lib/services/reports";
import { requireTenant, tx } from "@/lib/tenant";
import { UrgencyBadge } from "../../badges";

export const metadata: Metadata = { title: "Inventory report" };

export default async function ReportPage(props: PageProps<"/app/reports/[id]">) {
  const t = await requireTenant();
  const { id } = await props.params;
  const { data: d } = await tx(t, (db) => getReport(db, t.businessId, id));
  const csv = (s: string) => `/api/reports/${id}/csv?section=${s}`;
  const pct = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : ""}${v}%`);
  return (
    <>
      <PageHeader
        back={{ href: "/app/reports", label: "Reports" }}
        title={`Inventory report · ${formatDate(d.period.start)} – ${formatDate(d.period.end)}`}
        description={`Sales data through ${formatDate(d.dataAsOf.salesThrough)} · last stock count ${formatDate(d.dataAsOf.lastStockCount)} · generated ${new Date(d.generatedAt).toLocaleString("en-IN", { timeZone: t.business.timezone })}`}
        actions={<a href={`/api/reports/${id}/pdf`} className={buttonClass("primary")}>Download PDF</a>}
      />
      {d.business.isDemo && <Alert tone="warn" className="mb-6">Synthetic demo data — not a real business.</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock value at cost" value={formatINR(d.metrics.inventoryValue, { whole: true })} />
        <Stat label="To review for reorder" value={`${d.reorderTotal.items}`} sub={`est. ${formatINR(d.reorderTotal.value, { whole: true })}`} />
        <Stat label="Stockout risks" value={`${d.stockoutRisks.length}`} sub="out of stock or runs out before delivery" />
        <Stat label="Excess & non-moving" value={formatINR(d.excessValue, { whole: true })} />
        <Stat label="Sales in period" value={formatINR(d.sales.current.value, { whole: true })} sub={d.sales.comparable ? `${pct(d.sales.changePct) ?? "—"} vs ${formatDate(d.previous.start)} – ${formatDate(d.previous.end)}` : "no comparison (history does not cover both periods)"} />
        <Stat label="Units sold" value={formatQty(d.sales.current.qty)} sub={`${d.sales.current.products} products`} />
        <Stat label="Purchases recorded" value={formatINR(d.purchases.current.value, { whole: true })} sub={d.purchases.comparable ? `${pct(d.purchases.changePct) ?? "—"} vs previous period` : "from imported purchase history"} />
        <Stat label="Goods received" value={formatINR(d.purchases.receiptsValue, { whole: true })} sub="confirmed receipts in period" />
      </div>

      <Section title={`Reorder review (${d.reorderTotal.items})`} csv={csv("reorder")} items={d.reorder} cols={["status", "stock", "qty", "cost"]} />
      <Panel className="mt-6" title="Purchasing needs by supplier" actions={<a href={csv("suppliers")} className="text-sm text-signal hover:underline">CSV</a>} bodyClassName="p-0">
        {d.suppliers.length === 0 ? (
          <p className="p-5 text-sm text-muted">Nothing to order.</p>
        ) : (
          <Table minWidth={420}>
            <thead><tr><Th>Supplier</Th><Th align="right">Items</Th><Th align="right">Estimated value</Th></tr></thead>
            <tbody>
              {d.suppliers.map((s) => (
                <tr key={s.supplier}><Td>{s.supplier}</Td><Td align="right">{s.items}</Td><Td align="right">{formatINR(s.value, { whole: true })}</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      <Section title={`Stockout risks (${d.stockoutRisks.length})`} csv={csv("stockouts")} items={d.stockoutRisks} cols={["status", "stock", "detail"]} />
      <Section title="Slow-moving and excess stock" csv={csv("slow")} items={d.slow} cols={["stock", "value", "excess", "detail"]} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Data quality">
          {d.dataQuality.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">{d.dataQuality.map((q) => <li key={q}>{q}</li>)}</ul>
          ) : (
            <p className="text-sm text-muted">No issues found.</p>
          )}
        </Panel>
        <Panel title="Assumptions behind these numbers">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{d.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </Panel>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-0.5 text-xl font-semibold text-ink">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Section({ title, csv, items, cols }: { title: string; csv: string; items: ReportItem[]; cols: ("status" | "stock" | "qty" | "cost" | "value" | "excess" | "detail")[] }) {
  return (
    <Panel className="mt-6" title={title} actions={<a href={csv} className="text-sm text-signal hover:underline">CSV</a>} bodyClassName="p-0">
      {items.length === 0 ? (
        <p className="p-5 text-sm text-muted">None.</p>
      ) : (
        <Table minWidth={640}>
          <thead>
            <tr>
              <Th>Product</Th>
              {cols.includes("status") && <Th>Status</Th>}
              {cols.includes("stock") && <Th align="right">In stock</Th>}
              {cols.includes("qty") && <Th align="right">Suggested</Th>}
              {cols.includes("cost") && <Th align="right">Est. cost</Th>}
              {cols.includes("value") && <Th align="right">Stock value</Th>}
              {cols.includes("excess") && <Th align="right">Excess value</Th>}
              {cols.includes("detail") && <Th>Detail</Th>}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.productId}>
                <Td><Link href={`/app/inventory/${r.productId}`} className="font-medium text-ink hover:text-signal">{r.name}</Link><span className="block text-xs text-muted">{r.sku}{r.supplier ? ` · ${r.supplier}` : ""}</span></Td>
                {cols.includes("status") && <Td>{r.status && <UrgencyBadge urgency={r.status as never} />}</Td>}
                {cols.includes("stock") && <Td align="right">{formatQty(r.onHand)} <span className="text-xs text-muted">{r.unit}</span></Td>}
                {cols.includes("qty") && <Td align="right">{formatQty(r.qty ?? 0)}</Td>}
                {cols.includes("cost") && <Td align="right">{r.cost === null || r.cost === undefined ? "—" : formatINR(r.cost, { whole: true })}</Td>}
                {cols.includes("value") && <Td align="right">{r.value === null ? "—" : formatINR(r.value, { whole: true })}</Td>}
                {cols.includes("excess") && <Td align="right">{r.cost === null || r.cost === undefined ? "—" : formatINR(r.cost, { whole: true })}</Td>}
                {cols.includes("detail") && <Td className="text-muted">{r.detail}</Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
