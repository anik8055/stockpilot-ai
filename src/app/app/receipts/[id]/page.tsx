import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { Alert, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/domain/dates";
import { formatINR, formatQty } from "@/lib/domain/money";
import { getReceipt } from "@/lib/services/purchasing";
import { requireTenant, tx } from "@/lib/tenant";
import { cancelReceiptAction, confirmReceiptAction } from "../../invoices/actions";

export const metadata: Metadata = { title: "Goods receipt" };

export default async function ReceiptPage(props: PageProps<"/app/receipts/[id]">) {
  const t = await requireTenant();
  const { id } = await props.params;
  const { confirmed } = await props.searchParams;
  const { receipt: r, lines } = await tx(t, (db) => getReceipt(db, t.businessId, id));
  return (
    <>
      <PageHeader
        back={r.invoice_document_id ? { href: `/app/invoices/${r.invoice_document_id}`, label: "Invoice" } : r.purchase_order_id ? { href: `/app/purchase-orders/${r.purchase_order_id}`, label: r.po_number ?? "Purchase order" } : { href: "/app/purchase-orders", label: "Purchase orders" }}
        title={`Goods receipt ${r.receipt_number}`}
        description={`${r.supplier_name} · received ${formatDate(r.received_on)}${r.supplier_invoice_ref ? ` · invoice ${r.supplier_invoice_ref}` : ""}${r.po_number ? ` · against ${r.po_number}` : ""}`}
      />
      {confirmed === "again" && <Alert tone="info" className="mb-4" title="Already confirmed">Stock was not added twice.</Alert>}
      {confirmed && confirmed !== "again" && <Alert tone="ok" className="mb-4" title="Stock updated">{confirmed} item(s) added to stock.</Alert>}
      {r.status === "draft" && <Alert tone="warn" className="mb-4" title="Draft — stock has not changed yet">Check the quantities, then confirm to add them to stock.</Alert>}
      {r.status === "cancelled" && <Alert tone="neutral" className="mb-4" title="Cancelled">This receipt was cancelled; stock was not changed.</Alert>}
      <Panel title="Items" bodyClassName="p-0">
        <Table minWidth={560}>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">In stock units</Th>
              <Th align="right">Unit cost</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.name}<span className="block text-xs text-muted">{l.sku}</span></Td>
                <Td align="right">{formatQty(l.quantity)} {l.unit}</Td>
                <Td align="right">{formatQty(l.quantity_base)} {l.base_unit}</Td>
                <Td align="right">{l.unit_cost === null ? "—" : formatINR(l.unit_cost)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {r.status === "draft" && can(t.role, "receipts.confirm") && (
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionForm action={confirmReceiptAction}>
            <input type="hidden" name="receiptId" value={r.id} />
            <SubmitButton pendingLabel="Updating stock…">Confirm and add to stock</SubmitButton>
          </ActionForm>
          <ConfirmAction action={cancelReceiptAction} hidden={{ receiptId: r.id }} label="Cancel receipt" size="md" title="Cancel this draft receipt?" body="Stock will not change. You can create a new receipt from the invoice later." confirmLabel="Cancel receipt" />
        </div>
      )}
      {r.status === "confirmed" && (
        <p className="mt-6 text-sm text-muted">
          Confirmed {r.confirmed_at ? new Date(r.confirmed_at).toLocaleString("en-IN", { timeZone: t.business.timezone }) : ""}. <Link href="/app/inventory" className="text-signal hover:underline">View products</Link>
        </p>
      )}
    </>
  );
}
