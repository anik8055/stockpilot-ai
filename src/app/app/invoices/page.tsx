import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, EmptyState, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { aiStatus } from "@/lib/ai/provider";
import { formatDate } from "@/lib/domain/dates";
import { formatINR } from "@/lib/domain/money";
import { env } from "@/lib/env";
import { loadEntitlements } from "@/lib/queries";
import { listInvoices } from "@/lib/services/invoices";
import { requireTenant, tx } from "@/lib/tenant";
import { InvoiceUpload } from "./upload";

export const metadata: Metadata = { title: "Supplier invoices" };

const STATUS: Record<string, [string, "warn" | "ok" | "danger" | "neutral" | "info"]> = {
  uploaded: ["Reading", "neutral"],
  needs_review: ["Needs review", "warn"],
  unsupported: ["Could not read", "danger"],
  failed: ["Failed", "danger"],
  confirmed: ["Received into stock", "ok"],
};

export default async function InvoicesPage() {
  const t = await requireTenant();
  const ent = await loadEntitlements(t);
  const invoices = await tx(t, (db) => listInvoices(db, t.businessId));
  const ai = await aiStatus(false);
  const ocr = env().OCR_PROVIDER !== "none";
  return (
    <>
      <PageHeader title="Supplier invoices" description="Upload a purchase invoice to turn it into a goods receipt. You review every line first." />
      {!ent.features.invoice_extraction ? (
        <Alert tone="info" title="Invoice reading is part of the Growth plan">Your plan does not include invoice extraction. <Link href="/app/settings?tab=plan" className="underline">See plans</Link></Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Panel title="Upload an invoice">
            <InvoiceUpload maxMb={env().MAX_INVOICE_FILE_MB} />
            <p className="mt-4 text-sm text-muted">
              No invoice handy? <a href="/api/invoices/sample" className="text-signal hover:underline">Download a sample invoice</a> made from your own supplier and products (marked as a sample).
            </p>
          </Panel>
          <Panel title="How reading works">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
              <li>PDF invoices with a text layer are read directly. Rows are accepted only when quantity × rate matches the amount.</li>
              <li>{ai.configured ? "When the rule-based reading does not add up, the invoice text is structured by the AI model and checked again." : "AI structuring is off; unusual layouts may need more manual correction."}</li>
              <li>{ocr ? "Scans and photos are read with OCR — check them carefully." : "Scans and photos need OCR, which is not configured. You will be told instead of getting a guess."}</li>
              <li>Items are matched by supplier code, SKU, part number or exact name. Anything less certain is left for you to choose.</li>
            </ul>
          </Panel>
        </div>
      )}
      <Panel className="mt-6" title="Recent invoices" bodyClassName="p-0">
        {invoices.length === 0 ? (
          <div className="p-5"><EmptyState title="No invoices uploaded yet" /></div>
        ) : (
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Supplier</Th>
                <Th>Invoice no.</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="hover:bg-paper/60">
                  <Td><Link href={`/app/invoices/${i.id}`} className="font-medium text-ink hover:text-signal">{i.original_filename}</Link></Td>
                  <Td>{i.matched_supplier ?? <span className="text-muted">{i.supplier_name ?? "—"}</span>}</Td>
                  <Td>{i.invoice_number ?? "—"}</Td>
                  <Td>{formatDate(i.invoice_date)}</Td>
                  <Td><Badge tone={STATUS[i.status]?.[1]}>{STATUS[i.status]?.[0] ?? i.status}</Badge></Td>
                  <Td align="right">{i.total === null ? "—" : formatINR(i.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
