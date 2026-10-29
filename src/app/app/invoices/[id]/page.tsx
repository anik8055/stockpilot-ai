import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ConfirmAction } from "@/components/client";
import { Alert, buttonClass, PageHeader, Panel } from "@/components/ui";
import { getInvoice } from "@/lib/services/invoices";
import { requireTenant, tx } from "@/lib/tenant";
import { discardInvoiceAction } from "../actions";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Review invoice" };

/** numeric(14,2) strings → plain numbers for editing ("4464.00" → "4464"); null → "". */
const s = (v: string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

export default async function InvoicePage(props: PageProps<"/app/invoices/[id]">) {
  const t = await requireTenant();
  const { id } = await props.params;
  const { duplicate } = await props.searchParams;
  const { doc, lines } = await tx(t, (db) => getInvoice(db, t.businessId, id));
  const [suppliers, products, openPos] = [
    await tx(t, (db) => db.query<{ id: string; name: string }>("SELECT id, name FROM suppliers WHERE business_id = $1 AND active ORDER BY name", [t.businessId])),
    await tx(t, (db) => db.query<{ id: string; sku: string; name: string }>("SELECT id, sku, name FROM products WHERE business_id = $1 AND active ORDER BY name LIMIT 5000", [t.businessId])),
    await tx(t, (db) => db.query<{ id: string; po_number: string; supplier_id: string }>("SELECT id, po_number, supplier_id FROM purchase_orders WHERE business_id = $1 AND status IN ('sent','partially_received') ORDER BY created_at DESC", [t.businessId])),
  ];
  const readOnly = doc.status === "confirmed" || doc.status === "unsupported";
  return (
    <>
      <PageHeader
        back={{ href: "/app/invoices", label: "Supplier invoices" }}
        title={doc.invoice_number ? `Invoice ${doc.invoice_number}` : doc.original_filename}
        description={`${doc.original_filename} · read with ${doc.provider === "pdf_text+llm" ? "PDF text + AI structuring (checked)" : doc.provider === "pdf_text+rules" ? "PDF text + rules" : doc.provider === "ocr_tesseract+rules" || doc.provider === "ocr_tesseract+llm" ? "OCR" : "—"}`}
        actions={
          <>
            <a href={`/api/invoices/${doc.id}/file`} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>Open original</a>
            {doc.status !== "confirmed" && (
              <ConfirmAction action={discardInvoiceAction} hidden={{ invoiceId: doc.id }} label="Discard" size="md" title="Discard this invoice?" body="It will be removed from the list. Nothing in your stock changes." confirmLabel="Discard" />
            )}
          </>
        }
      />
      {duplicate && <Alert tone="warn" className="mb-4" title="You uploaded this exact file before">Showing the earlier upload instead of reading it twice.</Alert>}
      {doc.extraction?.duplicateOf && <Alert tone="warn" className="mb-4" title="Possible duplicate invoice">Another invoice from this supplier has the same invoice number. <Link className="underline" href={`/app/invoices/${doc.extraction.duplicateOf}`}>Open it</Link></Alert>}
      {doc.status === "unsupported" && <Alert tone="danger" className="mb-4" title="This file could not be read automatically">{doc.error}</Alert>}
      {doc.status === "confirmed" && doc.goods_receipt_id && (
        <Alert tone="ok" className="mb-4" title="Received into stock">
          <Link href={`/app/receipts/${doc.goods_receipt_id}`} className="underline">View the goods receipt</Link>
        </Alert>
      )}
      {doc.goods_receipt_id && doc.status !== "confirmed" && (
        <Alert tone="info" className="mb-4" title="A draft goods receipt exists for this invoice">
          <Link href={`/app/receipts/${doc.goods_receipt_id}`} className="underline">Open it to confirm</Link> — stock changes only when you confirm it.
        </Alert>
      )}
      {doc.warnings.length > 0 && doc.status !== "unsupported" && (
        <Alert tone="warn" className="mb-4" title="Check before receiving">
          <ul className="list-disc pl-5">
            {doc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Panel title="Review the invoice" description="Correct anything that was misread. Highlighted amounts don't match quantity × rate.">
        <ReviewForm
          invoiceId={doc.id}
          idempotencyKey={`inv-${doc.id.slice(0, 8)}-${randomUUID()}`}
          readOnly={readOnly || !!doc.goods_receipt_id}
          header={{ supplier_id: doc.supplier_id ?? "", invoice_number: doc.invoice_number ?? "", invoice_date: doc.invoice_date ?? "", subtotal: s(doc.subtotal), tax_total: s(doc.tax_total), total: s(doc.total) }}
          lines={lines.map((l) => ({
            key: l.id,
            id: l.id,
            include: true,
            description: l.description,
            quantity: s(l.quantity),
            unit: l.unit ?? "",
            unit_price: s(l.unit_price),
            discount_amount: s(l.discount_amount),
            line_total: s(l.line_total),
            product_id: l.matched_product_id ?? "",
            match_method: l.match_method,
            suggestions: l.warnings?.suggestions ?? [],
          }))}
          suppliers={suppliers}
          products={products}
          openPos={openPos}
        />
      </Panel>
    </>
  );
}
