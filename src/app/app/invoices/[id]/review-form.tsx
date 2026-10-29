"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/client";
import { Alert, Field, Input, Select } from "@/components/ui";
import { checkInvoice } from "@/lib/domain/invoice";
import { saveInvoiceAction } from "../actions";

type Line = {
  key: string;
  id: string | null;
  include: boolean;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_amount: string;
  line_total: string;
  product_id: string;
  match_method: string | null;
  suggestions: { productId: string; score: number }[];
};

type Props = {
  invoiceId: string;
  idempotencyKey: string;
  readOnly: boolean;
  header: { supplier_id: string; invoice_number: string; invoice_date: string; subtotal: string; tax_total: string; total: string };
  lines: Line[];
  suppliers: { id: string; name: string }[];
  products: { id: string; sku: string; name: string }[];
  openPos: { id: string; po_number: string; supplier_id: string }[];
};

const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
const METHOD: Record<string, string> = { supplier_code: "Supplier code", sku: "SKU", alias: "Alias", mpn: "Part no.", name: "Exact name", user: "Chosen", suggested: "Suggestion" };

export function ReviewForm(p: Props) {
  const [header, setHeader] = useState(p.header);
  const [lines, setLines] = useState(p.lines);
  const productName = useMemo(() => new Map(p.products.map((x) => [x.id, `${x.name} (${x.sku})`])), [p.products]);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const check = checkInvoice({
    subtotal: n(header.subtotal),
    tax_total: n(header.tax_total),
    total: n(header.total),
    lines: lines.filter((l) => l.include).map((l) => ({ description: l.description || "-", quantity: n(l.quantity), unit_price: n(l.unit_price), discount_amount: n(l.discount_amount), line_total: n(l.line_total), tax_rate: null })),
  });
  const unmatched = lines.filter((l) => l.include && !l.product_id).length;
  const pos = p.openPos.filter((o) => o.supplier_id === header.supplier_id);

  return (
    <ActionForm action={saveInvoiceAction} className="space-y-6">
      <input type="hidden" name="invoiceId" value={p.invoiceId} />
      <input type="hidden" name="idempotencyKey" value={p.idempotencyKey} />
      <fieldset disabled={p.readOnly} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Supplier" htmlFor="supplier_id" className="sm:col-span-3 lg:col-span-2">
          <Select id="supplier_id" name="supplier_id" value={header.supplier_id} onChange={(e) => setHeader({ ...header, supplier_id: e.target.value })}>
            <option value="">Choose supplier…</option>
            {p.suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice no." htmlFor="invoice_number">
          <Input id="invoice_number" name="invoice_number" defaultValue={header.invoice_number} />
        </Field>
        <Field label="Invoice date" htmlFor="invoice_date">
          <Input id="invoice_date" name="invoice_date" type="date" defaultValue={header.invoice_date} />
        </Field>
        <Field label="Taxable value" htmlFor="subtotal">
          <Input id="subtotal" name="subtotal" inputMode="decimal" value={header.subtotal} onChange={(e) => setHeader({ ...header, subtotal: e.target.value })} />
        </Field>
        <Field label="Tax (GST)" htmlFor="tax_total">
          <Input id="tax_total" name="tax_total" inputMode="decimal" value={header.tax_total} onChange={(e) => setHeader({ ...header, tax_total: e.target.value })} />
        </Field>
        <Field label="Invoice total" htmlFor="total">
          <Input id="total" name="total" inputMode="decimal" value={header.total} onChange={(e) => setHeader({ ...header, total: e.target.value })} />
        </Field>
      </fieldset>

      <div className="space-y-2" aria-live="polite">
        {check.checks.map((c, i) => (
          <Alert key={i} tone={c.level === "ok" ? "ok" : c.level === "error" ? "danger" : "warn"}>{c.message}</Alert>
        ))}
        <p className="text-xs text-muted">Included lines add up to ₹{check.linesTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.</p>
      </div>

      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-paper text-left text-xs text-muted">
              <th className="px-2 py-2 font-semibold">Use</th>
              <th className="px-2 py-2 font-semibold">Description on invoice</th>
              <th className="px-2 py-2 font-semibold">Your product</th>
              <th className="px-2 py-2 text-right font-semibold">Qty</th>
              <th className="px-2 py-2 font-semibold">Unit</th>
              <th className="px-2 py-2 text-right font-semibold">Rate</th>
              <th className="px-2 py-2 text-right font-semibold">Disc.</th>
              <th className="px-2 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const q = n(l.quantity);
              const r = n(l.unit_price);
              const a = n(l.line_total);
              const bad = q !== null && r !== null && a !== null && Math.abs(q * r - (n(l.discount_amount) ?? 0) - a) > Math.max(0.6, a * 0.005);
              return (
                <tr key={l.key} className={`border-b border-line align-top ${l.include ? "" : "opacity-50"}`}>
                  <td className="px-2 py-2">
                    <input type="hidden" name="line" value={l.key} />
                    {l.id && <input type="hidden" name={`id_${l.key}`} value={l.id} />}
                    <input type="checkbox" name={`inc_${l.key}`} checked={l.include} onChange={(e) => set(l.key, { include: e.target.checked })} disabled={p.readOnly} aria-label="Include this line" className="mt-2.5 h-4 w-4 accent-signal" />
                  </td>
                  <td className="px-2 py-2">
                    <input name={`d_${l.key}`} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} disabled={p.readOnly} aria-label="Description" className="h-9 w-full min-w-48 rounded-md border border-line-strong px-2" />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      name={`p_${l.key}`}
                      value={l.product_id}
                      onChange={(e) => set(l.key, { product_id: e.target.value, match_method: e.target.value ? "user" : null })}
                      disabled={p.readOnly}
                      aria-label="Matched product"
                      aria-invalid={l.include && !l.product_id}
                      className={`h-9 w-full min-w-56 rounded-md border px-1 ${l.include && !l.product_id ? "border-warn bg-warn-soft" : "border-line-strong"}`}
                    >
                      <option value="">— choose product —</option>
                      {l.suggestions.length > 0 && (
                        <optgroup label="Suggestions (check before choosing)">
                          {l.suggestions.map((s) => (
                            <option key={`s-${s.productId}`} value={s.productId}>
                              {productName.get(s.productId)} · {Math.round(s.score * 100)}% similar
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="All products">
                        {p.products.map((x) => (
                          <option key={x.id} value={x.id}>{x.name} ({x.sku})</option>
                        ))}
                      </optgroup>
                    </select>
                    {l.product_id && l.match_method && <span className="mt-0.5 block text-xs text-muted">Matched by: {METHOD[l.match_method] ?? l.match_method}</span>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input name={`q_${l.key}`} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} disabled={p.readOnly} inputMode="decimal" aria-label="Quantity" className="num h-9 w-20 rounded-md border border-line-strong px-2 text-right" />
                  </td>
                  <td className="px-2 py-2">
                    <input name={`u_${l.key}`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })} disabled={p.readOnly} aria-label="Unit" className="h-9 w-16 rounded-md border border-line-strong px-2" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input name={`r_${l.key}`} value={l.unit_price} onChange={(e) => set(l.key, { unit_price: e.target.value })} disabled={p.readOnly} inputMode="decimal" aria-label="Rate" className="num h-9 w-24 rounded-md border border-line-strong px-2 text-right" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input name={`ds_${l.key}`} value={l.discount_amount} onChange={(e) => set(l.key, { discount_amount: e.target.value })} disabled={p.readOnly} inputMode="decimal" aria-label="Discount" className="num h-9 w-20 rounded-md border border-line-strong px-2 text-right" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input name={`a_${l.key}`} value={l.line_total} onChange={(e) => set(l.key, { line_total: e.target.value })} disabled={p.readOnly} inputMode="decimal" aria-label="Amount" aria-invalid={bad} className={`num h-9 w-28 rounded-md border px-2 text-right ${bad ? "border-danger bg-danger-soft" : "border-line-strong"}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!p.readOnly && (
        <button
          type="button"
          className="text-sm font-medium text-signal hover:underline"
          onClick={() => setLines((ls) => [...ls, { key: `new${ls.length}`, id: null, include: true, description: "", quantity: "", unit: "", unit_price: "", discount_amount: "", line_total: "", product_id: "", match_method: null, suggestions: [] }])}
        >
          + Add a line the reader missed
        </button>
      )}

      {!p.readOnly && (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            {pos.length > 0 && (
              <Field label="Receive against purchase order (optional)" htmlFor="purchaseOrderId">
                <Select id="purchaseOrderId" name="purchaseOrderId" defaultValue="">
                  <option value="">No purchase order</option>
                  {pos.map((o) => (
                    <option key={o.id} value={o.id}>{o.po_number}</option>
                  ))}
                </Select>
              </Field>
            )}
            {!check.consistent && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="acceptMismatch" className="h-4 w-4 accent-signal" /> Totals checked — continue anyway
              </label>
            )}
            {unmatched > 0 && <p className="text-sm text-warn">{unmatched} line(s) still need a product before receiving.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="intent" value="save" className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-info-soft">
              Save corrections
            </button>
            <button
              type="submit"
              name="intent"
              value="receive"
              disabled={unmatched > 0 || !header.supplier_id}
              className="inline-flex h-10 items-center rounded-md bg-signal px-4 text-sm font-medium text-white hover:bg-signal-strong disabled:cursor-not-allowed disabled:bg-signal/50"
            >
              Create goods receipt
            </button>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
