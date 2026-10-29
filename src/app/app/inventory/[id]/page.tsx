import type { Metadata } from "next";
import Link from "next/link";
import { WeeklyUnitsChart } from "@/components/charts";
import { Alert, Badge, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { loadEntitlements } from "@/lib/queries";
import { analyzeWorkspace } from "@/lib/services/analysis";
import { getProduct, productFacets } from "@/lib/services/catalog";
import { requireTenant, tx } from "@/lib/tenant";
import { ConfidenceBadge, QualityBadge, UrgencyBadge } from "../../badges";
import { updateProductAction } from "../actions";
import { ProductForm } from "../product-form";
import { AdjustForm, AliasForm, ArchiveButton, RemoveButton, SupplierTermsForm, UnitForm } from "./forms";

export const metadata: Metadata = { title: "Product" };

const MOVEMENT_LABEL: Record<string, string> = {
  opening: "Opening stock",
  snapshot_adjustment: "Stock count difference",
  receipt: "Goods received",
  manual_adjustment: "Manual adjustment",
  sale: "Sale",
  customer_return: "Customer return",
  supplier_return: "Returned to supplier",
  write_off: "Write-off",
};

export default async function ProductPage(props: PageProps<"/app/inventory/[id]">) {
  const t = await requireTenant();
  const { id } = await props.params;
  const { created } = await props.searchParams;
  const data = await tx(t, (db) => getProduct(db, t.businessId, id));
  const { suppliers } = await tx(t, (db) => productFacets(db, t.businessId));
  const analysis = await tx(t, (db) => analyzeWorkspace(db, t.businessId, t.business.settings.analysis, { timezone: t.business.timezone, productIds: [id] }));
  const ent = await loadEntitlements(t);
  const a = analysis.products[0];
  const p = data.product;
  const unit = p.base_unit;
  const editable = can(t.role, "inventory.edit");
  const cheapest = data.supplierProducts.filter((s) => s.purchase_price !== null).sort((x, y) => Number(x.purchase_price) - Number(y.purchase_price))[0];

  return (
    <>
      <PageHeader
        back={{ href: "/app/inventory", label: "Products" }}
        title={p.name}
        description={
          <>
            {p.sku}
            {p.category ? ` · ${p.category}` : ""}
            {p.brand ? ` · ${p.brand}` : ""}
            {!p.active && (
              <Badge className="ml-2" tone="warn">
                Archived
              </Badge>
            )}
          </>
        }
        actions={editable ? <ArchiveButton id={p.id} active={p.active} /> : undefined}
      />
      {created && <Alert tone="ok" className="mb-6" title="Product added" />}

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <Panel title="Stock and reorder advice" description={a.demand.windowEnd ? `Demand measured ${formatDate(a.demand.windowStart)} – ${formatDate(a.demand.windowEnd)}` : "No sales history yet"}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Stat label="In stock" value={`${formatQty(a.onHand)} ${unit}`} />
            <Stat label="On order" value={`${formatQty(a.reorder.inbound)} ${unit}`} />
            <Stat label="Avg. daily sales" value={a.demand.averageDailyDemand === null ? "—" : `${formatQty(a.demand.averageDailyDemand)} ${unit}`} />
            <Stat label="Days of stock" value={a.reorder.daysOfStock === null ? "—" : `${a.reorder.daysOfStock}`} />
            <Stat label="Reorder point" value={a.reorder.reorderPoint === null ? "—" : formatQty(a.reorder.reorderPoint)} />
            <Stat label="Target level" value={a.reorder.targetLevel === null ? "—" : formatQty(a.reorder.targetLevel)} />
            <Stat label="Lead time" value={`${a.reorder.leadTimeDays} days`} />
            <Stat label="Trend" value={{ rising: "Rising", falling: "Falling", stable: "Stable", unknown: "Not enough data" }[a.demand.trend]} />
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <UrgencyBadge urgency={a.reorder.urgency} provisional={a.reorder.provisional} />
            <QualityBadge quality={a.demand.quality} />
            {a.reorder.eligible && <ConfidenceBadge confidence={a.reorder.confidence} />}
            {a.movement.flags.map((f) => (
              <Badge key={f.code} tone={f.severity === "high" ? "danger" : f.severity === "medium" ? "warn" : "neutral"} title={f.rule}>
                {f.label}
              </Badge>
            ))}
          </div>
          {ent.features.reorder_engine && a.reorder.suggestedQty > 0 && (
            <p className="mt-4 rounded-md bg-signal-soft px-4 py-3 text-sm text-signal-strong">
              Suggested order: <strong className="num">{formatQty(a.reorder.suggestedQty)} {unit}</strong>
              {a.reorder.estimatedCost !== null && <> · about {formatINR(a.reorder.estimatedCost, { whole: true })}</>}
              {a.supplierName && <> from {a.supplierName}</>}. <Link href="/app/purchasing" className="font-medium underline">Review in purchase list</Link>
            </p>
          )}
          <details className="mt-4 text-sm" open>
            <summary className="cursor-pointer font-medium text-ink">How this was worked out</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {a.reorder.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {a.movement.flags.map((f) => (
                <li key={f.code}>{f.rule}</li>
              ))}
              {a.reorder.warnings.map((w) => (
                <li key={w} className="text-warn">{w}</li>
              ))}
              {a.costChange && (
                <li className="text-warn">
                  Latest purchase cost {formatINR(a.costChange.latest)} is {a.costChange.changePct > 0 ? "up" : "down"} {Math.abs(a.costChange.changePct)}% from the usual {formatINR(a.costChange.median)}.
                </li>
              )}
            </ul>
          </details>
        </Panel>

        <Panel title="Units sold per week" description="Last 26 weeks of imported sales">
          {data.weekly.length >= 3 ? <WeeklyUnitsChart data={data.weekly.map((w) => ({ week: formatDate(w.week).slice(0, 6), qty: Number(w.qty) }))} unit={unit} /> : <p className="text-sm text-muted">Not enough sales history to chart.</p>}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Suppliers and prices" description={data.supplierProducts.length > 1 && cheapest ? `Lowest recorded price: ${cheapest.supplier_name} at ${formatINR(cheapest.purchase_price)} / ${unit}` : "Supplier-specific codes, prices and order sizes"}>
          {data.supplierProducts.length === 0 ? (
            <p className="mb-4 text-sm text-muted">No supplier terms yet. Add them so purchase orders use the right price and order sizes.</p>
          ) : (
            <Table minWidth={520} className="mb-4">
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Code</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">MOQ / pack</Th>
                  <Th align="right">Lead</Th>
                  <Th>{" "}</Th>
                </tr>
              </thead>
              <tbody>
                {data.supplierProducts.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      {s.supplier_name}
                      {s.supplier_id === p.preferred_supplier_id && <Badge className="ml-1.5" tone="info">Preferred</Badge>}
                    </Td>
                    <Td className="text-muted">{s.supplier_sku ?? "—"}</Td>
                    <Td align="right">
                      {s.purchase_price === null ? "—" : formatINR(s.purchase_price)}
                      {s.price_updated_at && <span className="block text-xs text-muted">{formatDate(new Date(s.price_updated_at))}</span>}
                    </Td>
                    <Td align="right">{s.moq ?? "—"} / {s.pack_size ?? "—"}</Td>
                    <Td align="right">{s.lead_time_days ?? "—"}</Td>
                    <Td align="right">{editable && <RemoveButton kind="supplier" id={p.id} childId={s.id} label={s.supplier_name} />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {editable && (suppliers.length ? <SupplierTermsForm id={p.id} suppliers={suppliers} baseUnit={unit} /> : <p className="text-sm text-muted"><Link href="/app/suppliers" className="text-signal underline">Add a supplier</Link> first.</p>)}
        </Panel>

        <div className="space-y-6">
          <Panel title="Units" description={`Stock is counted in ${unit}. Other units convert only where you define it.`}>
            <ul className="mb-3 space-y-1 text-sm">
              {data.units.length === 0 && <li className="text-muted">No other units.</li>}
              {data.units.map((u) => (
                <li key={u.id} className="flex items-center justify-between">
                  <span>
                    1 {u.unit_code} = {formatQty(u.factor_to_base)} {unit}
                  </span>
                  {editable && <RemoveButton kind="unit" id={p.id} childId={u.id} label={u.unit_code} />}
                </li>
              ))}
            </ul>
            {editable && <UnitForm id={p.id} baseUnit={unit} />}
          </Panel>
          <Panel title="Other codes" description="Supplier codes, aliases and old SKUs that imports and invoices should recognise.">
            <ul className="mb-3 space-y-1 text-sm">
              {data.aliases.length === 0 && <li className="text-muted">None.</li>}
              {data.aliases.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span>
                    <strong className="font-medium">{x.value}</strong> <span className="text-muted">· {x.alias_type === "supplier_code" ? `${x.supplier_name ?? "supplier"} code` : x.alias_type === "old_sku" ? "old SKU" : "alias"}</span>
                  </span>
                  {editable && <RemoveButton kind="alias" id={p.id} childId={x.id} label={x.value} />}
                </li>
              ))}
            </ul>
            {editable && <AliasForm id={p.id} suppliers={suppliers} />}
          </Panel>
        </div>
      </div>

      {can(t.role, "inventory.adjust") && (
        <Panel className="mt-6" title="Record a stock count" description="Posts the difference to the stock ledger with your reason. For many items, import a stock count file instead.">
          <AdjustForm id={p.id} unit={unit} current={a.onHand} />
        </Panel>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="Stock ledger" description="Every change to stock, newest first. Entries are never edited or deleted." bodyClassName="p-0">
          {data.movements.length === 0 ? (
            <p className="p-5 text-sm text-muted">No stock movements yet.</p>
          ) : (
            <Table minWidth={460}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th align="right">Change</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap">{formatDate(new Date(m.occurred_at))}</Td>
                    <Td>{MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}</Td>
                    <Td align="right" className={Number(m.quantity) < 0 ? "text-danger" : "text-ok"}>
                      {Number(m.quantity) > 0 ? "+" : ""}
                      {formatQty(m.quantity)}
                    </Td>
                    <Td className="text-xs text-muted">{m.note ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Recent purchases" description="From imported purchase history" bodyClassName="p-0">
          {data.purchases.length === 0 ? (
            <p className="p-5 text-sm text-muted">No purchase history imported for this product.</p>
          ) : (
            <Table minWidth={460}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Supplier</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Unit cost</Th>
                </tr>
              </thead>
              <tbody>
                {data.purchases.map((h, i) => (
                  <tr key={i}>
                    <Td className="whitespace-nowrap">{formatDate(h.purchased_on)}</Td>
                    <Td>{h.supplier_name ?? "—"}</Td>
                    <Td align="right">{formatQty(h.quantity)}</Td>
                    <Td align="right">{h.unit_cost === null ? "—" : formatINR(h.unit_cost)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      {editable && (
        <Panel className="mt-6" title="Product details">
          <ProductForm action={updateProductAction} suppliers={suppliers} submitLabel="Save changes" values={p as Record<string, string | number | null>} />
        </Panel>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 font-semibold text-ink">{value}</dd>
    </div>
  );
}
