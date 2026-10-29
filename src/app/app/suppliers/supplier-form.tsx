"use client";

import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

export function SupplierForm({ action, values = {}, submitLabel }: { action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>; values?: Record<string, unknown>; submitLabel: string }) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(s) => {
        const v = (k: string) => (s?.values && k in s.values ? s.values[k] : values[k] === null || values[k] === undefined ? "" : String(values[k]));
        const e = s?.fieldErrors ?? {};
        const f = (k: string, label: string, extra: Record<string, string> = {}) => (
          <Field key={k} label={label} htmlFor={`s-${k}`} error={e[k]}>
            <Input id={`s-${k}`} name={k} defaultValue={v(k)} aria-invalid={!!e[k]} {...extra} />
          </Field>
        );
        return (
          <>
            {typeof values.id === "string" && <input type="hidden" name="id" value={values.id} />}
            {f("name", "Supplier name")}
            {f("contact_person", "Contact person")}
            {f("phone", "Phone / WhatsApp", { type: "tel", inputMode: "tel" })}
            {f("email", "Email", { type: "email" })}
            {f("gstin", "GSTIN", { maxLength: "15" })}
            {f("default_lead_time_days", "Usual lead time (days)", { inputMode: "numeric" })}
            {f("address", "Address")}
            {f("city", "City")}
            {f("state", "State")}
            {f("payment_terms", "Payment terms")}
            <Field label="Notes" htmlFor="s-notes" className="sm:col-span-2">
              <Textarea id="s-notes" name="notes" rows={2} defaultValue={v("notes")} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
