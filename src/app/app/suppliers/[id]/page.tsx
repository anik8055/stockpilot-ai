import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmAction } from "@/components/client";
import { Badge, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/domain/dates";
import { formatINR } from "@/lib/domain/money";
import { getSupplier } from "@/lib/services/purchasing";
import { requireTenant, tx } from "@/lib/tenant";
import { toggleSupplierAction, updateSupplierAction } from "../../purchasing/actions";
import { PoStatusBadge } from "../../purchase-orders/status";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage(props: PageProps<"/app/suppliers/[id]">) {
  const t = await requireTenant();
  const { id } = await props.params;
  const { supplier, products, orders } = await tx(t, (db) => getSupplier(db, t.businessId, id));
  const editable = can(t.role, "suppliers.edit");
  return (
    <>
      <PageHeader
        back={{ href: "/app/suppliers", label: "Suppliers" }}
        title={supplier.name}
        description={[supplier.city, supplier.phone, supplier.gstin ? `GSTIN ${supplier.gstin}` : null].filter(Boolean).join(" · ") || undefined}
        actions={
          editable ? (
            <ConfirmAction
              action={toggleSupplierAction}
              hidden={{ id: supplier.id, active: supplier.active ? "false" : "true" }}
              label={supplier.active ? "Archive" : "Restore"}
              variant={supplier.active ? "danger" : "primary"}
              title={supplier.active ? "Archive this supplier?" : "Restore this supplier?"}
              body={supplier.active ? "Past orders and prices are kept. Archived suppliers are hidden from lists." : "The supplier will appear in lists again."}
              confirmLabel={supplier.active ? "Archive" : "Restore"}
            />
          ) : undefined
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={`Items supplied (${products.length})`} bodyClassName="p-0">
          {products.length === 0 ? (
            <p className="p-5 text-sm text-muted">No items linked yet. Link items from a product page, or import a product list with a supplier column.</p>
          ) : (
            <Table minWidth={460}>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Their code</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">MOQ</Th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.product_id}>
                    <Td>
                      <Link href={`/app/inventory/${p.product_id}`} className="text-ink hover:text-signal">{p.name}</Link>
                      {p.preferred && <Badge className="ml-1.5" tone="info">Preferred</Badge>}
                    </Td>
                    <Td className="text-muted">{p.supplier_sku ?? "—"}</Td>
                    <Td align="right">{p.purchase_price === null ? "—" : formatINR(p.purchase_price)}</Td>
                    <Td align="right">{p.moq ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Recent purchase orders" bodyClassName="p-0">
          {orders.length === 0 ? (
            <p className="p-5 text-sm text-muted">No purchase orders yet.</p>
          ) : (
            <Table minWidth={420}>
              <thead>
                <tr>
                  <Th>PO</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <Td><Link href={`/app/purchase-orders/${o.id}`} className="font-medium text-ink hover:text-signal">{o.po_number}</Link></Td>
                    <Td>{formatDate(o.order_date)}</Td>
                    <Td><PoStatusBadge status={o.status} /></Td>
                    <Td align="right">{formatINR(o.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
      {editable && (
        <Panel className="mt-6" title="Supplier details">
          <SupplierForm action={updateSupplierAction} values={supplier} submitLabel="Save supplier" />
        </Panel>
      )}
    </>
  );
}
