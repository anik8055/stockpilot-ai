"use client";

import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { Field, Input, Select } from "@/components/ui";
import type { AnalysisSettings } from "@/lib/domain/settings";
import { analysisAction, cancelSubscriptionAction, changePasswordAction, deleteAccountAction, deleteWorkspaceAction, joinCodeAction, memberRoleAction, profileAction, refreshBillingAction, removeMemberAction, subscribeAction } from "./actions";

export function ProfileForm({ v, disabled }: { v: Record<string, string | null>; disabled: boolean }) {
  return (
    <ActionForm action={profileAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(s) => {
        const val = (k: string) => (s?.values && k in s.values ? s.values[k] : (v[k] ?? ""));
        const e = s?.fieldErrors ?? {};
        const f = (k: string, label: string, extra: Record<string, string> = {}) => (
          <Field key={k} label={label} htmlFor={`b-${k}`} error={e[k]}>
            <Input id={`b-${k}`} name={k} defaultValue={val(k)} disabled={disabled} aria-invalid={!!e[k]} {...extra} />
          </Field>
        );
        return (
          <>
            {f("name", "Business name")}
            {f("legal_name", "Legal name (on POs)")}
            <Field label="Trade" htmlFor="b-industry">
              <Select id="b-industry" name="industry" defaultValue={val("industry")} disabled={disabled}>
                <option value="electrical">Electrical supplies</option>
                <option value="hardware">Hardware & tools</option>
                <option value="auto_parts">Automobile spare parts</option>
                <option value="wholesale">Wholesale trading</option>
                <option value="distribution">Distribution</option>
                <option value="general">Other</option>
              </Select>
            </Field>
            {f("gstin", "GSTIN", { maxLength: "15" })}
            {f("phone", "Phone", { type: "tel" })}
            {f("email", "Email for POs", { type: "email" })}
            {f("address_line1", "Address line 1")}
            {f("address_line2", "Address line 2")}
            {f("city", "City")}
            {f("state", "State")}
            {f("pincode", "PIN code", { inputMode: "numeric", maxLength: "6" })}
            {!disabled && (
              <div className="sm:col-span-2 lg:col-span-3">
                <SubmitButton>Save business details</SubmitButton>
              </div>
            )}
          </>
        );
      }}
    </ActionForm>
  );
}

export function AnalysisForm({ a, disabled }: { a: AnalysisSettings; disabled: boolean }) {
  return (
    <ActionForm action={analysisAction} className="space-y-5">
      {(s) => {
        const e = s?.fieldErrors ?? {};
        const num = (k: keyof AnalysisSettings, label: string, hint: string) => (
          <Field label={label} htmlFor={`a-${k}`} hint={hint} error={e[k]}>
            <Input id={`a-${k}`} name={k} inputMode="decimal" defaultValue={s?.values?.[k] ?? String(a[k])} disabled={disabled} aria-invalid={!!e[k]} />
          </Field>
        );
        return (
          <>
            <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold text-ink">Reordering</legend>
              {num("targetCoverageDays", "Cover target (days)", "How many days of sales each order should cover after delivery.")}
              {num("defaultLeadTimeDays", "Default lead time (days)", "Used when neither the product nor the supplier has a lead time.")}
              {num("defaultSafetyDays", "Default safety stock (days of sales)", "Extra buffer when a product has no safety stock set.")}
              {num("demandLookbackDays", "Demand window (days)", "Sales history used to measure average daily sales.")}
              {num("minHistoryDays", "Minimum history (days)", "Less history than this makes a suggestion provisional.")}
              <label className="flex items-start gap-2 self-end rounded-md border border-line p-3 text-sm">
                <input type="checkbox" name="useTrendAdjustment" defaultChecked={a.useTrendAdjustment} disabled={disabled} className="mt-0.5 h-4 w-4 accent-signal" />
                <span>
                  Weight recent sales more
                  <span className="block text-xs text-muted">60% last 30 days, 40% whole window — only when both periods have enough data.</span>
                </span>
              </label>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold text-ink">Slow and excess stock</legend>
              <Field label="Default window" htmlFor="a-slowMovingDays" hint="Used for dashboard and reports; analysis lets you switch." error={e.slowMovingDays}>
                <Select id="a-slowMovingDays" name="slowMovingDays" defaultValue={String(a.slowMovingDays)} disabled={disabled}>
                  {[30, 60, 90, 180].map((d) => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </Select>
              </Field>
              {num("slowVelocityPerMonth", "Slow-moving below (units / month)", "Items selling fewer than this are slow-moving.")}
              {num("excessCoverageDays", "Excess beyond (days of sales)", "Stock above this many days of sales counts as excess.")}
            </fieldset>
            {!disabled && <SubmitButton>Save stock settings</SubmitButton>}
          </>
        );
      }}
    </ActionForm>
  );
}

export function JoinCode({ code }: { code: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="rounded-md border border-line bg-paper px-3 py-2 text-lg font-semibold tracking-widest text-ink">{code ?? "—"}</code>
      <ConfirmAction action={joinCodeAction} label="Create new code" variant="secondary" title="Replace the join code?" body="Anyone with the old code will no longer be able to join. People who already joined are not affected." confirmLabel="Create new code" />
    </div>
  );
}

export function MemberRole({ userId, role, canOwner }: { userId: string; role: string; canOwner: boolean }) {
  return (
    <ActionForm action={memberRoleAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <label className="sr-only" htmlFor={`role-${userId}`}>Role</label>
      <select id={`role-${userId}`} name="role" defaultValue={role} className="h-8 rounded-md border border-line-strong px-2 text-sm">
        {canOwner && <option value="owner">Owner</option>}
        <option value="admin">Administrator</option>
        <option value="staff">Staff</option>
      </select>
      <SubmitButton size="sm" variant="secondary">Update</SubmitButton>
    </ActionForm>
  );
}

export function RemoveMember({ userId, self }: { userId: string; self: boolean }) {
  return (
    <ConfirmAction
      action={removeMemberAction}
      hidden={{ userId }}
      label={self ? "Leave" : "Remove"}
      title={self ? "Leave this workspace?" : "Remove this member?"}
      body={self ? "You will lose access to this workspace's data." : "They will lose access immediately. Their past actions stay in the activity log."}
      confirmLabel={self ? "Leave workspace" : "Remove"}
    />
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="grid max-w-md gap-3" resetOnSuccess>
      <Field label="Current password" htmlFor="pw-current"><Input id="pw-current" name="current" type="password" autoComplete="current-password" required /></Field>
      <Field label="New password" htmlFor="pw-next" hint="At least 10 characters, with a letter and a number."><Input id="pw-next" name="next" type="password" autoComplete="new-password" required /></Field>
      <Field label="Confirm new password" htmlFor="pw-confirm"><Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <div><SubmitButton variant="secondary">Change password</SubmitButton></div>
    </ActionForm>
  );
}

export function DeleteWorkspaceForm({ name }: { name: string }) {
  return (
    <ActionForm action={deleteWorkspaceAction} className="grid max-w-md gap-3">
      <Field label={`Type the workspace name (${name})`} htmlFor="dw-name"><Input id="dw-name" name="confirmName" autoComplete="off" required /></Field>
      <Field label="Your password" htmlFor="dw-pw"><Input id="dw-pw" name="password" type="password" autoComplete="current-password" required /></Field>
      <div><SubmitButton variant="danger" pendingLabel="Deleting…">Delete workspace and all its data</SubmitButton></div>
    </ActionForm>
  );
}

export function DeleteAccountForm() {
  return (
    <ActionForm action={deleteAccountAction} className="grid max-w-md gap-3">
      <Field label="Type DELETE to confirm" htmlFor="da-confirm"><Input id="da-confirm" name="confirm" autoComplete="off" required /></Field>
      <Field label="Your password" htmlFor="da-pw"><Input id="da-pw" name="password" type="password" autoComplete="current-password" required /></Field>
      <div><SubmitButton variant="danger" pendingLabel="Deleting…">Delete my account</SubmitButton></div>
    </ActionForm>
  );
}

export function SubscribeButton({ plan, label }: { plan: string; label: string }) {
  return (
    <ActionForm action={subscribeAction} className="mt-3">
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton size="sm" pendingLabel="Opening payment page…">{label}</SubmitButton>
    </ActionForm>
  );
}

export function CancelSubscription({ endsAt }: { endsAt: string | null }) {
  return (
    <ConfirmAction
      action={cancelSubscriptionAction}
      label="Cancel subscription"
      title="Cancel the subscription?"
      body={endsAt ? `You keep your current plan until ${endsAt}. After that the workspace switches to Starter features; no data is deleted.` : "The subscription has not been charged yet and will be cancelled now."}
      confirmLabel="Cancel subscription"
    />
  );
}

export function RefreshBilling() {
  return (
    <ActionForm action={refreshBillingAction}>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">Check payment status</SubmitButton>
    </ActionForm>
  );
}
