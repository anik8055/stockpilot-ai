import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, LinkButton, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { formatINR } from "@/lib/domain/money";
import { listSuppliers } from "@/lib/services/purchasing";
import { requireTenant, tx } from "@/lib/tenant";
import { createSupplierAction } from "../purchasing/actions";
import { SupplierForm } from "./supplier-form";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const t = await requireTenant();
  const suppliers = await tx(t, (db) => listSuppliers(db, t.businessId));
  return (
    <>
      <PageHeader title="Suppliers" description="Lead times and order sizes here drive the purchase list." actions={<LinkButton href="/app/imports/new?kind=suppliers" variant="secondary">Import suppliers</LinkButton>} />
      {suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet">Add them below or import a supplier list. Suppliers named in your product or purchase imports are created automatically.</EmptyState>
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>City</Th>
                <Th align="right">Lead time</Th>
                <Th align="right">Items supplied</Th>
                <Th align="right">Open POs</Th>
                <Th align="right">Purchases (90 days)</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-paper/60">
                  <Td>
                    <Link href={`/app/suppliers/${s.id}`} className="font-medium text-ink hover:text-signal">{s.name}</Link>
                    {!s.active && <Badge className="ml-2">Archived</Badge>}
                    {s.phone && <span className="block text-xs text-muted">{s.phone}</span>}
                  </Td>
                  <Td className="text-muted">{s.city ?? "—"}</Td>
                  <Td align="right">{s.default_lead_time_days === null ? <span className="text-warn">Not set</span> : `${s.default_lead_time_days} days`}</Td>
                  <Td align="right">{s.products}</Td>
                  <Td align="right">{s.open_pos}</Td>
                  <Td align="right">{s.purchased_90d === null ? "—" : formatINR(s.purchased_90d, { whole: true })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {can(t.role, "suppliers.edit") && (
        <Panel className="mt-6" title="Add supplier">
          <SupplierForm action={createSupplierAction} submitLabel="Add supplier" />
        </Panel>
      )}
    </>
  );
}
