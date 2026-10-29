import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/client";
import { Alert, EmptyState, Field, Input, PageHeader, Panel, Select } from "@/components/ui";
import { formatDate } from "@/lib/domain/dates";
import { listReports } from "@/lib/services/reports";
import { requireTenant, tx } from "@/lib/tenant";
import { generateReportAction } from "./actions";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const t = await requireTenant();
  const reports = await tx(t, (db) => listReports(db, t.businessId));
  return (
    <>
      <PageHeader title="Inventory reports" description="A one-page summary for the owner: what to order, stockout risks, slow stock and data problems." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Generate a report">
          <ActionForm action={generateReportAction} className="space-y-4">
            <Field label="Period" htmlFor="preset">
              <Select id="preset" name="preset" defaultValue="last7">
                <option value="last7">Last 7 days</option>
                <option value="prevweek">Previous week (Mon–Sun)</option>
                <option value="last30">Last 30 days</option>
                <option value="custom">Custom dates</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From (custom)" htmlFor="start">
                <Input id="start" name="start" type="date" />
              </Field>
              <Field label="To (custom)" htmlFor="end">
                <Input id="end" name="end" type="date" />
              </Field>
            </div>
            <SubmitButton pendingLabel="Calculating…">Generate report</SubmitButton>
          </ActionForm>
          <Alert tone="neutral" className="mt-5">
            Reports are generated when you ask. Automatic weekly email delivery is not switched on yet — it needs an email service to be configured.
          </Alert>
        </Panel>
        <Panel title="Saved reports" bodyClassName="p-0">
          {reports.length === 0 ? (
            <div className="p-5"><EmptyState title="No reports yet">Generate your first report on the left.</EmptyState></div>
          ) : (
            <ul>
              {reports.map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0 sm:px-5">
                  <Link href={`/app/reports/${r.id}`} className="font-medium text-ink hover:text-signal">
                    {formatDate(r.period_start)} – {formatDate(r.period_end)}
                  </Link>
                  <span className="text-xs text-muted">generated {new Date(r.generated_at).toLocaleString("en-IN", { timeZone: t.business.timezone, dateStyle: "medium", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
