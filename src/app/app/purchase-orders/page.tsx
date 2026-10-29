import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/domain/dates";
import { formatINR } from "@/lib/domain/money";
import { listPurchaseOrders } from "@/lib/services/purchasing";
import { requireTenant, tx } from "@/lib/tenant";
import { PoStatusBadge } from "./status";

export const metadata: Metadata = { title: "Purchase orders" };

const TABS = [
  ["", "All"],
  ["draft", "Drafts"],
  ["sent", "Sent"],
  ["partially_received", "Partly received"],
  ["received", "Received"],
  ["cancelled", "Cancelled"],
] as const;

export default async function PurchaseOrdersPage(props: PageProps<"/app/purchase-orders">) {
  const t = await requireTenant();
  const { status } = await props.searchParams;
  const st = typeof status === "string" && TABS.some(([k]) => k === status) ? status : "";
  const orders = await tx(t, (db) => listPurchaseOrders(db, t.businessId, st || undefined));
  return (
    <>
      <PageHeader title="Purchase orders" description="Drafts stay private until you mark them as sent. Sent orders count as stock on order." actions={<LinkButton href="/app/purchasing">Open purchase list</LinkButton>} />
      <nav aria-label="Status" className="mb-4 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k ? `?status=${k}` : "?"} aria-current={k === st ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-sm ${k === st ? "border-ink bg-ink text-white" : "border-line bg-surface hover:bg-paper"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {orders.length === 0 ? (
        <EmptyState title="No purchase orders here" action={<LinkButton href="/app/purchasing">Create one from the purchase list</LinkButton>} />
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>PO</Th>
                <Th>Supplier</Th>
                <Th>Status</Th>
                <Th>Order date</Th>
                <Th>Expected</Th>
                <Th align="right">Lines</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-paper/60">
                  <Td><Link href={`/app/purchase-orders/${o.id}`} className="font-medium text-ink hover:text-signal">{o.po_number}</Link></Td>
                  <Td>{o.supplier_name}</Td>
                  <Td><PoStatusBadge status={o.status} /></Td>
                  <Td>{formatDate(o.order_date)}</Td>
                  <Td>{formatDate(o.expected_date)}</Td>
                  <Td align="right">{o.lines}</Td>
                  <Td align="right">{formatINR(o.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
