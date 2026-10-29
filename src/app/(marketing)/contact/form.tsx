"use client";

import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { demoRequestAction } from "./actions";

export function ContactForm() {
  return (
    <ActionForm action={demoRequestAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
      {(s) => (
        <>
          <Field label="Your name" htmlFor="name" error={s?.fieldErrors?.name}>
            <Input id="name" name="name" autoComplete="name" required aria-invalid={!!s?.fieldErrors?.name} />
          </Field>
          <Field label="Email" htmlFor="email" error={s?.fieldErrors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!s?.fieldErrors?.email} />
          </Field>
          <Field label="Phone / WhatsApp" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" />
          </Field>
          <Field label="Business name" htmlFor="company">
            <Input id="company" name="company" autoComplete="organization" />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" autoComplete="address-level2" />
          </Field>
          <Field label="Trade" htmlFor="industry">
            <Select id="industry" name="industry" defaultValue="">
              <option value="">Select…</option>
              <option value="electrical">Electrical supplies</option>
              <option value="hardware">Hardware & tools</option>
              <option value="auto_parts">Automobile spare parts</option>
              <option value="wholesale">Wholesale / distribution</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="What would you like to see?" htmlFor="message" className="sm:col-span-2">
            <Textarea id="message" name="message" rows={4} placeholder="E.g. we have about 3,000 items in Tally and want to cut slow stock." />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Sending…">Request a demo</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
