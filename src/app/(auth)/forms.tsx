"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, Select } from "@/components/ui";
import { createBusinessAction, createDemoAction, forgotPasswordAction, joinBusinessAction, loginAction, resetPasswordAction, signupAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      {(s) => (
      <>
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" defaultValue={s?.values?.email} type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" hint={<Link href="/forgot-password" className="text-signal hover:underline">Forgot password?</Link>}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </>
      )}
    </ActionForm>
  );
}

export function SignupForm() {
  return (
    <ActionForm action={signupAction} className="space-y-4">
      {(s) => (
        <>
          <Field label="Your name" htmlFor="name" error={s?.fieldErrors?.name}>
            <Input id="name" name="name" defaultValue={s?.values?.name} autoComplete="name" required autoFocus aria-invalid={!!s?.fieldErrors?.name} />
          </Field>
          <Field label="Work email" htmlFor="email" error={s?.fieldErrors?.email}>
            <Input id="email" name="email" defaultValue={s?.values?.email} type="email" autoComplete="email" required aria-invalid={!!s?.fieldErrors?.email} />
          </Field>
          <Field label="Password" htmlFor="password" error={s?.fieldErrors?.password} hint="At least 10 characters, with a letter and a number.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!s?.fieldErrors?.password} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-muted">
            <input type="checkbox" name="terms" className="mt-1 h-4 w-4 accent-signal" required />
            <span>
              I agree to the <Link href="/terms" className="text-signal hover:underline">terms</Link> and <Link href="/privacy" className="text-signal hover:underline">privacy policy</Link>.
            </span>
          </label>
          <SubmitButton className="w-full" pendingLabel="Creating account…">Create account</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ForgotForm() {
  return (
    <ActionForm action={forgotPasswordAction} className="space-y-4">
      {(s) => (
      <>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" defaultValue={s?.values?.email} type="email" autoComplete="email" required autoFocus />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Sending…">Send reset link</SubmitButton>
      </>
      )}
    </ActionForm>
  );
}

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction} className="space-y-4">
      {(s) =>
        s?.ok ? (
          <Link href="/login" className="block text-center font-medium text-signal hover:underline">Go to sign in</Link>
        ) : (
          <>
            <input type="hidden" name="token" value={token} />
            <Field label="New password" htmlFor="password" error={s?.fieldErrors?._ ?? s?.fieldErrors?.password} hint="At least 10 characters, with a letter and a number.">
              <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm" error={s?.fieldErrors?.confirm}>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Saving…">Set new password</SubmitButton>
          </>
        )
      }
    </ActionForm>
  );
}

export function OnboardingForms({ hasDemo }: { hasDemo: boolean }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  return (
    <div>
      <div role="tablist" aria-label="Workspace setup" className="mb-5 grid grid-cols-2 rounded-md border border-line bg-paper p-1 text-sm">
        {(["create", "join"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-2 font-medium ${mode === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {m === "create" ? "Set up my business" : "Join my team"}
          </button>
        ))}
      </div>
      {mode === "create" ? (
        <ActionForm action={createBusinessAction} className="space-y-4">
          {(s) => (
            <>
              <Field label="Business name" htmlFor="name" error={s?.fieldErrors?.name}>
                <Input id="name" name="name" defaultValue={s?.values?.name} required autoFocus placeholder="e.g. Sharma Electricals" aria-invalid={!!s?.fieldErrors?.name} />
              </Field>
              <Field label="What do you sell?" htmlFor="industry">
                <Select id="industry" name="industry" defaultValue={s?.values?.industry ?? "electrical"}>
                  <option value="electrical">Electrical supplies</option>
                  <option value="hardware">Hardware & tools</option>
                  <option value="auto_parts">Automobile spare parts</option>
                  <option value="wholesale">Wholesale trading</option>
                  <option value="distribution">Distribution</option>
                  <option value="general">Something else</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City" htmlFor="city">
                  <Input id="city" name="city" defaultValue={s?.values?.city} autoComplete="address-level2" />
                </Field>
                <Field label="State" htmlFor="state">
                  <Input id="state" name="state" defaultValue={s?.values?.state} autoComplete="address-level1" />
                </Field>
              </div>
              <Field label="GSTIN (optional)" htmlFor="gstin" error={s?.fieldErrors?.gstin} hint="Printed on your purchase orders.">
                <Input id="gstin" name="gstin" defaultValue={s?.values?.gstin} maxLength={15} className="uppercase" aria-invalid={!!s?.fieldErrors?.gstin} />
              </Field>
              <SubmitButton className="w-full" pendingLabel="Creating workspace…">Create workspace</SubmitButton>
            </>
          )}
        </ActionForm>
      ) : (
        <ActionForm action={joinBusinessAction} className="space-y-4">
          <Field label="Join code" htmlFor="code" hint="Ask the owner for the code shown in Settings → Team.">
            <Input id="code" name="code" required autoFocus className="font-medium tracking-widest uppercase" maxLength={12} placeholder="ABCD2345EF" />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Joining…">Join workspace</SubmitButton>
        </ActionForm>
      )}
      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm text-muted">Just looking? Explore a workspace filled with synthetic data for a fictional electricals wholesaler.</p>
        <ActionForm action={createDemoAction} className="mt-3">
          <SubmitButton variant="secondary" className="w-full" pendingLabel="Preparing demo data…">
            {hasDemo ? "Open demo workspace" : "Explore the demo workspace"}
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
