import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { Alert, buttonClass, Field, Input, PageHeader, Panel, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { formatDate, todayIn } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { getPurchaseOrder } from "@/lib/services/purchasing";
import { requireTenant, tx } from "@/lib/tenant";
import { cancelPoAction, markSentAction, receiveGoodsAction, updatePoAction } from "../../purchasing/actions";
import { PoStatusBadge } from "../status";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage(props: PageProps<"/app/purchase-orders/[id]">) {
  const t = await requireTenant();
  const { id } = await props.params;
  const { created, sent, received, over } = await props.searchParams;
  const { po, lines, receipts } = await tx(t, (db) => getPurchaseOrder(db, t.businessId, id));
  const draft = po.status === "draft";
  const open = po.status === "sent" || po.status === "partially_received";
  const products = draft
    ? await tx(t, (db) => db.query<{ id: string; sku: string; name: string }>("SELECT id, sku, name FROM products WHERE business_id = $1 AND active ORDER BY name LIMIT 2000", [t.businessId]))
    : [];
  const today = todayIn(t.business.timezone);

  return (
    <>
      <PageHeader
        back={{ href: "/app/purchase-orders", label: "Purchase orders" }}
        title={`${po.po_number} · ${po.supplier_name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <PoStatusBadge status={po.status} /> Ordered {formatDate(po.order_date)}
            {po.expected_date && <> · expected {formatDate(po.expected_date)}</>}
            {po.sent_at && <> · marked sent {formatDate(new Date(po.sent_at))}</>}
          </span>
        }
        actions={
          <>
            <a href={`/api/purchase-orders/${po.id}/pdf`} className={buttonClass("secondary")}>Download PDF</a>
            {draft && can(t.role, "purchasing.approve") && (
              <ConfirmAction
                action={markSentAction}
                hidden={{ poId: po.id }}
                label="Mark as sent"
                variant="primary"
                size="md"
                title="Mark this order as sent?"
                body="Do this after you have sent the PDF to the supplier yourself (WhatsApp, email or in person). StockPilot does not send anything. The quantities will count as stock on order until received."
                confirmLabel="Mark as sent"
              />
            )}
            {(draft || open) && can(t.role, "purchasing.approve") && (
              <ConfirmAction action={cancelPoAction} hidden={{ poId: po.id }} label="Cancel order" size="md" title="Cancel this purchase order?" body="It will no longer count as stock on order. Goods already received stay in stock." confirmLabel="Cancel order" />
            )}
          </>
        }
      />
      {sent && <Alert tone="ok" className="mb-6" title="Marked as sent">Its quantities now count as stock on order until received.</Alert>}
      {received === "duplicate" && <Alert tone="info" className="mb-6" title="Already recorded">This receipt had already been saved — stock was not added twice.</Alert>}
      {received && received !== "duplicate" && (
        <Alert tone="ok" className="mb-6" title="Goods received">
          Stock updated for {received} item(s).{typeof over === "string" && over ? ` More than ordered was received for ${over}.` : ""}
        </Alert>
      )}
      {created && !sent && !received && (
        <Alert tone="ok" className="mb-6" title={`Draft ${po.po_number} created`}>
          Check quantities and prices, download the PDF and send it to the supplier, then mark it as sent.
        </Alert>
      )}
      {po.status === "sent" && <Alert tone="neutral" className="mb-6">Marked as sent — this does not mean the supplier has accepted it. Confirm with them before relying on the delivery date.</Alert>}

      {draft ? (
        <Panel title="Edit draft" bodyClassName="p-0">
          <ActionForm action={updatePoAction}>
            <input type="hidden" name="poId" value={po.id} />
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Rate (₹)</Th>
                  <Th align="right">GST %</Th>
                  <Th align="right">Amount</Th>
                  <Th align="center">Remove</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <input type="hidden" name="lineId" value={l.id} />
                      <Link href={`/app/inventory/${l.product_id}`} className="font-medium text-ink hover:text-signal">{l.name}</Link>
                      <span className="block text-xs text-muted">
                        {l.sku}
                        {l.recommendation && typeof l.recommendation.suggestedQty === "number" ? ` · suggested ${formatQty(l.recommendation.suggestedQty as number)}` : ""}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="inline-flex items-center gap-1">
                        <input name={`q_${l.id}`} defaultValue={Number(l.quantity)} inputMode="decimal" aria-label={`Quantity for ${l.name}`} className="num h-9 w-20 rounded-md border border-line-strong px-2 text-right" />
                        <span className="text-xs text-muted">{l.unit}</span>
                      </span>
                    </Td>
                    <Td align="right">
                      <input name={`p_${l.id}`} defaultValue={Number(l.unit_price)} inputMode="decimal" aria-label={`Rate for ${l.name}`} className="num h-9 w-24 rounded-md border border-line-strong px-2 text-right" />
                    </Td>
                    <Td align="right">
                      <select name={`t_${l.id}`} defaultValue={String(Number(l.tax_rate))} aria-label={`GST rate for ${l.name}`} className="h-9 rounded-md border border-line-strong px-1">
                        {["0", "5", "12", "18", "28"].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </Td>
                    <Td align="right">{formatINR(l.line_total)}</Td>
                    <Td align="center">
                      <input type="checkbox" name={`rm_${l.id}`} aria-label={`Remove ${l.name}`} className="h-4 w-4 accent-danger" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
              <Field label="Add item" htmlFor="addProductId" className="lg:col-span-2">
                <Select id="addProductId" name="addProductId" defaultValue="">
                  <option value="">—</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" htmlFor="addQty">
                <Input id="addQty" name="addQty" inputMode="decimal" />
              </Field>
              <Field label="Expected delivery" htmlFor="expected_date">
                <Input id="expected_date" name="expected_date" type="date" defaultValue={po.expected_date ?? ""} />
              </Field>
              <Field label="Notes for the supplier" htmlFor="notes" className="sm:col-span-2 lg:col-span-4">
                <Textarea id="notes" name="notes" rows={2} defaultValue={po.notes ?? ""} />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
                <Totals subtotal={po.subtotal} tax={po.tax_total} total={po.total} />
                <SubmitButton pendingLabel="Saving…">Save draft</SubmitButton>
              </div>
            </div>
          </ActionForm>
        </Panel>
      ) : (
        <Panel title="Items" bodyClassName="p-0">
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th align="right">Ordered</Th>
                <Th align="right">Received</Th>
                <Th align="right">Remaining</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const remaining = Math.max(0, Number(l.quantity_base) - Number(l.received_qty_base));
                return (
                  <tr key={l.id}>
                    <Td>
                      <Link href={`/app/inventory/${l.product_id}`} className="font-medium text-ink hover:text-signal">{l.name}</Link>
                      <span className="block text-xs text-muted">{l.sku}</span>
                    </Td>
                    <Td align="right">{formatQty(l.quantity_base)} {l.base_unit}</Td>
                    <Td align="right">{formatQty(l.received_qty_base)}</Td>
                    <Td align="right" className={remaining > 0 ? "font-semibold" : "text-ok"}>{remaining > 0 ? formatQty(remaining) : "Done"}</Td>
                    <Td align="right">{formatINR(l.unit_price)}</Td>
                    <Td align="right">{formatINR(l.line_total)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="flex justify-end p-4 sm:p-5">
            <Totals subtotal={po.subtotal} tax={po.tax_total} total={po.total} />
          </div>
        </Panel>
      )}

      {open && can(t.role, "receipts.confirm") && (
        <Panel className="mt-6" title="Receive goods" description="Enter what actually arrived. Stock is updated only when you confirm. Part deliveries are fine — the rest stays on order.">
          <ActionForm action={receiveGoodsAction} className="space-y-4">
            <input type="hidden" name="poId" value={po.id} />
            <input type="hidden" name="supplierId" value={po.supplier_id} />
            {/* New key per page render: a double-click or resubmit of this form cannot add stock twice. */}
            <input type="hidden" name="idempotencyKey" value={`po-${po.id.slice(0, 8)}-${randomUUID()}`} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Received on" htmlFor="receivedOn">
                <Input id="receivedOn" name="receivedOn" type="date" max={today} defaultValue={today} />
              </Field>
              <Field label="Supplier invoice / challan no." htmlFor="invoiceRef">
                <Input id="invoiceRef" name="invoiceRef" />
              </Field>
            </div>
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th align="right">Remaining</Th>
                  <Th align="right">Received now</Th>
                  <Th align="right">Invoice rate (optional)</Th>
                </tr>
              </thead>
              <tbody>
                {lines
                  .filter((l) => Number(l.quantity_base) - Number(l.received_qty_base) > 0)
                  .map((l) => {
                    const remaining = Number(l.quantity_base) - Number(l.received_qty_base);
                    return (
                      <tr key={l.id}>
                        <Td>
                          <input type="hidden" name="lineId" value={l.id} />
                          <input type="hidden" name={`prod_${l.id}`} value={l.product_id} />
                          {l.name}
                        </Td>
                        <Td align="right">{formatQty(remaining)} {l.base_unit}</Td>
                        <Td align="right">
                          <input name={`rq_${l.id}`} defaultValue={remaining} inputMode="decimal" aria-label={`Received quantity of ${l.name}`} className="num h-9 w-24 rounded-md border border-line-strong px-2 text-right" />
                        </Td>
                        <Td align="right">
                          <input name={`rc_${l.id}`} placeholder={String(Number(l.unit_price))} inputMode="decimal" aria-label={`Invoice rate for ${l.name}`} className="num h-9 w-24 rounded-md border border-line-strong px-2 text-right" />
                        </Td>
                      </tr>
                    );
                  })}
              </tbody>
            </Table>
            <SubmitButton pendingLabel="Updating stock…">Confirm receipt and update stock</SubmitButton>
          </ActionForm>
        </Panel>
      )}

      {receipts.length > 0 && (
        <Panel className="mt-6" title="Goods receipts" bodyClassName="p-0">
          <Table minWidth={520}>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Received on</Th>
                <Th>Invoice ref</Th>
                <Th>Status</Th>
                <Th align="right">Lines</Th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.receipt_number}</Td>
                  <Td>{formatDate(r.received_on)}</Td>
                  <Td>{r.supplier_invoice_ref ?? "—"}</Td>
                  <Td>{r.status === "confirmed" ? "Confirmed" : r.status === "draft" ? "Draft" : "Cancelled"}</Td>
                  <Td align="right">{r.lines}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}

function Totals({ subtotal, tax, total }: { subtotal: string; tax: string; total: string }) {
  return (
    <dl className="num grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-sm">
      <dt className="text-muted">Subtotal</dt>
      <dd className="text-right">{formatINR(subtotal)}</dd>
      <dt className="text-muted">GST</dt>
      <dd className="text-right">{formatINR(tax)}</dd>
      <dt className="font-semibold text-ink">Total</dt>
      <dd className="text-right font-semibold text-ink">{formatINR(total)}</dd>
    </dl>
  );
}
