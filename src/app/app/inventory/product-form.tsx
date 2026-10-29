"use client";

import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

type Values = Record<string, string | number | null | undefined>;

export function ProductForm({
  action,
  values = {},
  suppliers,
  submitLabel,
  showOpening,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  values?: Values;
  suppliers: { id: string; name: string }[];
  submitLabel: string;
  showOpening?: boolean;
}) {
  return (
    <ActionForm action={action} className="space-y-6">
      {(s) => {
        const v = (k: string) => (s?.values && k in s.values ? s.values[k] : values[k] === null || values[k] === undefined ? "" : String(values[k]));
        const e = s?.fieldErrors ?? {};
        const F = ({ k, label, hint, type = "text", inputMode }: { k: string; label: string; hint?: string; type?: string; inputMode?: "decimal" | "numeric" }) => (
          <Field label={label} htmlFor={k} hint={hint} error={e[k]}>
            <Input id={k} name={k} type={type} inputMode={inputMode} defaultValue={v(k)} aria-invalid={!!e[k]} />
          </Field>
        );
        return (
          <>
            {values.id && <input type="hidden" name="id" value={String(values.id)} />}
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-3 text-sm font-semibold text-ink">Identification</legend>
              {F({ k: "sku", label: "SKU / item code", hint: "Unique within your business." })}
              {F({ k: "name", label: "Product name" })}
              {F({ k: "barcode", label: "Barcode (optional)" })}
              {F({ k: "mpn", label: "Manufacturer part no. (optional)" })}
              {F({ k: "category", label: "Category" })}
              {F({ k: "brand", label: "Brand" })}
              <Field label="Description" htmlFor="description" className="sm:col-span-2">
                <Textarea id="description" name="description" rows={2} defaultValue={v("description")} />
              </Field>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-3 text-sm font-semibold text-ink">Units and prices</legend>
              <Field label="Base unit" htmlFor="base_unit" hint="Stock is counted in this unit. Add box/coil conversions on the product page.">
                <Input id="base_unit" name="base_unit" list="units" defaultValue={v("base_unit") || "pcs"} />
              </Field>
              {F({ k: "purchase_cost", label: "Purchase cost (₹ per base unit)", inputMode: "decimal" })}
              {F({ k: "selling_price", label: "Selling price (₹)", inputMode: "decimal" })}
              <datalist id="units">
                {["pcs", "box", "pack", "set", "pair", "m", "kg", "l", "roll", "coil", "dozen", "bundle"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-3 text-sm font-semibold text-ink">Stock settings</legend>
              {F({ k: "min_stock", label: "Minimum stock", inputMode: "decimal", hint: "Never reorder below this." })}
              {F({ k: "max_stock", label: "Maximum stock", inputMode: "decimal", hint: "Orders never go above this." })}
              {F({ k: "safety_stock", label: "Safety stock", inputMode: "decimal", hint: "Blank = business default days of sales." })}
              {F({ k: "lead_time_days", label: "Lead time (days)", inputMode: "numeric", hint: "Blank = supplier's lead time." })}
              {F({ k: "reserved_qty", label: "Reserved quantity", inputMode: "decimal", hint: "Promised to customers, not yet billed." })}
              {F({ k: "storage_location", label: "Storage location" })}
              <Field label="Preferred supplier" htmlFor="preferred_supplier_id" error={e.preferred_supplier_id}>
                <Select id="preferred_supplier_id" name="preferred_supplier_id" defaultValue={v("preferred_supplier_id")}>
                  <option value="">None</option>
                  {suppliers.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              </Field>
              {showOpening && F({ k: "opening_stock", label: "Opening stock (optional)", inputMode: "decimal", hint: "Recorded as an opening balance today." })}
            </fieldset>
            <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
