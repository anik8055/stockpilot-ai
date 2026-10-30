import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { aiStatus } from "@/lib/ai/provider";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/domain/dates";
import { env } from "@/lib/env";
import { loadEntitlements } from "@/lib/queries";
import { emailConfigured } from "@/lib/services/email";
import { monthlyUsage } from "@/lib/services/entitlements";
import { getPublicPlans } from "@/lib/services/public";
import { getProfile, listMembers, recentAudit } from "@/lib/services/settings";
import { requireTenant, tx } from "@/lib/tenant";
import { getBillingState } from "@/lib/services/billing";
import { AnalysisForm, CancelSubscription, RefreshBilling, SubscribeButton, DeleteAccountForm, DeleteWorkspaceForm, JoinCode, MemberRole, PasswordForm, ProfileForm, RemoveMember } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  ["business", "Business"],
  ["stock", "Stock settings"],
  ["team", "Team"],
  ["plan", "Plan & usage"],
  ["activity", "Activity log"],
  ["account", "Account & data"],
] as const;

export default async function SettingsPage(props: PageProps<"/app/settings">) {
  const t = await requireTenant();
  const { tab: raw, billing } = await props.searchParams;
  const tab = TABS.some(([k]) => k === raw) ? (raw as string) : "business";
  const manage = can(t.role, "settings.manage");

  return (
    <>
      <PageHeader title="Settings" description={`${t.business.name} · you are ${ROLE_LABELS[t.role].toLowerCase()}`} />
      <nav aria-label="Settings sections" className="-mx-4 mb-6 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`?tab=${k}`} aria-current={k === tab ? "page" : undefined} className={`shrink-0 rounded-md border px-3 py-1.5 text-sm ${k === tab ? "border-ink bg-ink text-white" : "border-line bg-surface hover:bg-paper"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {!manage && (tab === "business" || tab === "stock") && <Alert tone="neutral" className="mb-4">Only owners and administrators can change these settings.</Alert>}
      {tab === "business" && <BusinessTab t={t} manage={manage} />}
      {tab === "stock" && (
        <Panel title="How recommendations are calculated" description="Changes apply immediately to the dashboard, purchase list, reports and assistant.">
          <AnalysisForm a={t.business.settings.analysis} disabled={!manage} />
        </Panel>
      )}
      {tab === "team" && <TeamTab t={t} />}
      {tab === "plan" && <PlanTab t={t} notice={typeof billing === "string" ? billing : undefined} />}
      {tab === "activity" && <ActivityTab t={t} />}
      {tab === "account" && <AccountTab t={t} />}
    </>
  );
}

type T = Awaited<ReturnType<typeof requireTenant>>;

async function BusinessTab({ t, manage }: { t: T; manage: boolean }) {
  const p = await tx(t, (db) => getProfile(db, t.businessId));
  return (
    <Panel title="Business details" description="Shown on purchase orders and reports.">
      <ProfileForm v={p as Record<string, string | null>} disabled={!manage} />
    </Panel>
  );
}

async function TeamTab({ t }: { t: T }) {
  const members = await tx(t, (db) => listMembers(db));
  const p = await tx(t, (db) => getProfile(db, t.businessId));
  const ent = await loadEntitlements(t);
  const manage = can(t.role, "members.manage");
  return (
    <div className="space-y-6">
      <Panel title={`Members (${members.length} of ${ent.limits.max_members})`} bodyClassName="p-0">
        <Table minWidth={560}>
          <thead>
            <tr><Th>Name</Th><Th>Role</Th><Th>Joined</Th><Th>{" "}</Th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <Td>{m.name}{m.user_id === t.userId && <Badge className="ml-2">You</Badge>}<span className="block text-xs text-muted">{m.email}</span></Td>
                <Td>{manage && m.user_id !== t.userId ? <MemberRole userId={m.user_id} role={m.role} canOwner={t.role === "owner"} /> : ROLE_LABELS[m.role]}</Td>
                <Td>{formatDate(new Date(m.joined_at))}</Td>
                <Td align="right">{(manage || m.user_id === t.userId) && <RemoveMember userId={m.user_id} self={m.user_id === t.userId} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {manage && !t.business.isDemo && (
        <Panel title="Invite your team" description="Share this code. New members sign up, choose “Join my team” and enter it. They join as staff; you can change their role here.">
          <JoinCode code={p.join_code} />
        </Panel>
      )}
      <Panel title="What each role can do">
        <ul className="space-y-1.5 text-sm text-muted">
          <li><strong className="text-ink">Owner</strong> — everything, including billing and deleting the workspace.</li>
          <li><strong className="text-ink">Administrator</strong> — imports, settings, team, approving and cancelling purchase orders, stock adjustments.</li>
          <li><strong className="text-ink">Staff</strong> — view everything, edit products and suppliers, draft purchase orders, receive goods, upload invoices, run reports and use the assistant.</li>
        </ul>
      </Panel>
    </div>
  );
}

async function PlanTab({ t, notice }: { t: T; notice?: string }) {
  const ent = await loadEntitlements(t);
  const billingState = await tx(t, (db) => getBillingState(db, t.businessId));
  const isOwner = can(t.role, "billing.manage");
  const current = billingState.current;
  const usage = await tx(t, (db) => monthlyUsage(db, t.businessId));
  const plans = await getPublicPlans();
  const ai = await aiStatus(false);
  const productCount = (await tx(t, (db) => db.one<{ c: number }>("SELECT count(*)::int AS c FROM products WHERE business_id = $1", [t.businessId]))).c;
  const bar = (used: number, limit: number) => (
    <div className="mt-1 h-1.5 w-full rounded bg-info-soft" aria-hidden>
      <div className={`h-1.5 rounded ${used / Math.max(1, limit) > 0.9 ? "bg-warn" : "bg-signal"}`} style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
    </div>
  );
  const rows: [string, number, number][] = [
    ["Products", productCount, ent.limits.max_products],
    ["Imports this month", usage.imports, ent.limits.imports_per_month],
    ["AI questions this month", usage.ai, ent.limits.ai_requests_per_month],
    ["Invoices read this month", usage.invoices, ent.limits.invoice_extractions_per_month],
  ];
  return (
    <div className="space-y-6">
      {notice === "cancelled" && <Alert tone="ok">Subscription cancelled. Your plan stays active until the end of the paid period.</Alert>}
      {ent.status === "past_due" && <Alert tone="warn">The last renewal payment failed. Razorpay will retry; update your payment method from the link in Razorpay&apos;s email to avoid losing paid features.</Alert>}
      <Panel title={`Current plan: ${ent.plan.name}`} description={ent.trialEndsAt ? (ent.trialExpired ? "Trial ended — Starter features apply until a plan is activated." : `Trial ends ${formatDate(new Date(ent.trialEndsAt))}.`) : ent.plan.description}>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map(([label, used, limit]) => (
            <div key={label}>
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="num text-lg font-semibold text-ink">{used.toLocaleString("en-IN")} <span className="text-sm font-normal text-muted">of {limit.toLocaleString("en-IN")}</span></dd>
              {bar(used, limit)}
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title="Plans">
        <ul className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <li key={p.code} className={`rounded-md border p-4 ${p.code === ent.plan.code ? "border-ink" : "border-line"}`}>
              <p className="font-semibold text-ink">{p.name}</p>
              <p className="num text-sm text-muted">{p.isCustomPrice || p.priceInrMonthly === null ? "Custom pricing" : `₹${p.priceInrMonthly.toLocaleString("en-IN")} / month (indicative, excl. GST)`}</p>
              <p className="mt-1 text-xs text-muted">{p.description}</p>
              {isOwner && billingState.configured && billingState.subscribablePlans.includes(p.code) && (!current || current.status === "created") && !(ent.plan.code === p.code && ent.status === "active") && (
                <SubscribeButton plan={p.code} label={current?.status === "created" && current.planCode === p.code ? "Continue to payment" : `Subscribe to ${p.name}`} />
              )}
            </li>
          ))}
        </ul>
        {!billingState.configured ? (
          <Alert tone="neutral" className="mt-4">
            Online payment is not enabled on this installation. To change plans, <Link href="/contact" className="underline">contact us</Link> and we will activate it for this workspace.
          </Alert>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            {current && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3">
                <span>
                  Subscription: <Badge tone={current.status === "active" || current.status === "authenticated" ? "ok" : current.status === "pending" ? "warn" : "neutral"}>{current.status}</Badge>{" "}
                  {current.cancelAtCycleEnd && current.currentEnd ? `· ends ${formatDate(new Date(current.currentEnd))}` : current.currentEnd ? `· renews ${formatDate(new Date(current.currentEnd))}` : ""}
                </span>
                {isOwner && <RefreshBilling />}
                {isOwner && !current.cancelAtCycleEnd && <CancelSubscription endsAt={current.currentEnd && current.status !== "created" ? formatDate(new Date(current.currentEnd)) : null} />}
              </div>
            )}
            <p className="text-muted">
              Payments are processed by Razorpay on its own secure page; StockPilot never sees card or UPI details. Prices exclude GST. Your plan changes as soon as Razorpay confirms the payment.
              {!isOwner && " Only the workspace owner can change the plan."}
            </p>
          </div>
        )}
      </Panel>
      <Panel title="Services for this installation">
        <ul className="space-y-1.5 text-sm">
          <li>AI assistant and invoice structuring: {ai.configured ? <Badge tone="ok">On — {String(ai.provider)}</Badge> : <Badge>Off</Badge>}</li>
          <li>OCR for scanned invoices: {env().OCR_PROVIDER !== "none" ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}</li>
          <li>Email (password reset, future scheduled reports): {emailConfigured() ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Not configured</Badge>}</li>
        </ul>
      </Panel>
    </div>
  );
}

async function ActivityTab({ t }: { t: T }) {
  const events = await tx(t, (db) => recentAudit(db, t.businessId, 50));
  return (
    <Panel title="Recent activity" description="Important changes to stock, imports, purchasing and settings. Entries cannot be edited." bodyClassName="p-0">
      <Table minWidth={560}>
        <thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{new Date(e.created_at).toLocaleString("en-IN", { timeZone: t.business.timezone, dateStyle: "medium", timeStyle: "short" })}</Td>
              <Td>{e.actor ?? "—"}</Td>
              <Td>{e.action.replace(/[._]/g, " ")}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}

function AccountTab({ t }: { t: T }) {
  return (
    <div className="space-y-6">
      <Panel title="Password"><PasswordForm /></Panel>
      <Panel title="Your data" description="See the privacy page for what is stored and why.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Export products and analysis as CSV from the Products and Stock analysis pages; reports export as PDF and CSV.</li>
          <li>Deleting a workspace removes all its products, stock history, sales, purchases, invoices, files and reports immediately.</li>
        </ul>
      </Panel>
      {can(t.role, "business.delete") && (
        <Panel title="Delete this workspace" description="This cannot be undone.">
          <DeleteWorkspaceForm name={t.business.name} />
        </Panel>
      )}
      <Panel title="Delete my account" description="Removes your login. Workspaces where you are the only owner are deleted with all their data. This cannot be undone.">
        <DeleteAccountForm />
      </Panel>
    </div>
  );
}
