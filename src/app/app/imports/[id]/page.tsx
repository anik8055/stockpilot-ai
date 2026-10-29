import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { Alert, Badge, buttonClass, LinkButton, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { formatDate, todayIn } from "@/lib/domain/dates";
import { fieldsFor, IMPORT_KINDS } from "@/lib/domain/imports/fields";
import { formatQty } from "@/lib/domain/money";
import { getImportJob, listIssues, normalizedPreview, previewRows, previousImportOfSameFile } from "@/lib/services/imports";
import { requireTenant, tx, type TenantContext } from "@/lib/tenant";
import { cancelImportAction, changeSheetAction, commitImportAction, editMappingAction } from "../actions";
import { MappingForm } from "./mapping-form";

export const metadata: Metadata = { title: "Import" };

const RESULT_LABELS: Record<string, string> = {
  created: "Products created",
  updated: "Products updated",
  suppliersLinked: "Suppliers linked",
  stockCounted: "Stock counts recorded",
  stockAdjusted: "Stock levels changed",
  stockUnchanged: "Already matched (no change)",
  salesLinesAdded: "Sales lines added",
  purchaseLinesAdded: "Purchase lines added",
  alreadyImported: "Already imported earlier (skipped)",
};

export default async function ImportJobPage(props: PageProps<"/app/imports/[id]">) {
  const t = await requireTenant("imports.run");
  const { id } = await props.params;
  const job = await tx(t, (db) => getImportJob(db, t.businessId, id));
  const kind = IMPORT_KINDS[job.kind];
  const steps = ["Upload", "Match columns", "Review", "Done"];
  const stepIndex = job.status === "uploaded" ? 1 : job.status === "validated" ? 2 : job.status === "committed" ? 3 : 1;
  const ctx = { ...t, timezone: t.business.timezone };

  return (
    <>
      <PageHeader back={{ href: "/app/imports", label: "Imports" }} title={`${kind.label}: ${job.original_filename}`} description={kind.description} />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Import progress">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === stepIndex ? "step" : undefined} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i === stepIndex ? "border-ink bg-ink text-white" : i < stepIndex ? "border-ok/30 bg-ok-soft text-ok" : "border-line text-muted"}`}>
            <span className="font-semibold">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {job.status === "cancelled" && <Alert tone="neutral" title="This import was cancelled">Nothing from this file was saved.</Alert>}
      {job.status === "uploaded" && <MappingStep job={job} ctx={ctx} />}
      {job.status === "validated" && <ReviewStep job={job} ctx={ctx} />}
      {job.status === "committed" && <DoneStep job={job} />}
    </>
  );
}

type Job = Awaited<ReturnType<typeof getImportJob>>;
type Ctx = TenantContext & { timezone: string };

async function MappingStep({ job, ctx }: { job: Job; ctx: Ctx }) {
  const preview = await previewRows(job, 8);
  const s = job.options.suggestion;
  const headers = job.headers ?? [];
  return (
    <div className="space-y-6">
      {(job.options.sheets?.length ?? 0) > 1 || (job.header_row ?? 0) > 0 ? (
        <Panel title="Sheet and heading row" description={`Using sheet “${job.sheet_name}”, headings on row ${(job.header_row ?? 0) + 1}.`}>
          <ActionForm action={changeSheetAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="jobId" value={job.id} />
            {(job.options.sheets?.length ?? 0) > 1 && (
              <label className="text-sm">
                <span className="mb-1 block font-medium text-ink">Sheet</span>
                <select name="sheet" defaultValue={job.sheet_name ?? ""} className="h-10 rounded-md border border-line-strong bg-surface px-3">
                  {job.options.sheets!.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
            {(job.options.sheets?.length ?? 0) <= 1 && <input type="hidden" name="sheet" value={job.sheet_name ?? ""} />}
            <label className="text-sm">
              <span className="mb-1 block font-medium text-ink">Headings are on row</span>
              <input name="headerRow" inputMode="numeric" defaultValue={(job.header_row ?? 0) + 1} className="h-10 w-24 rounded-md border border-line-strong bg-surface px-3" />
            </label>
            <SubmitButton variant="secondary">Re-read headings</SubmitButton>
          </ActionForm>
        </Panel>
      ) : null}
      <Panel title="Match your columns" description={`${job.row_count ?? 0} rows below the headings. Required fields are marked *.`}>
        <MappingForm
          jobId={job.id}
          kind={job.kind}
          fields={fieldsFor(job.kind)}
          headers={headers}
          mapping={job.mapping ?? {}}
          confidence={s?.confidence ?? {}}
          ambiguities={s?.ambiguities ?? []}
          kindHints={s?.kindHints ?? []}
          preview={preview}
          dateOrder={job.options.dateOrder}
          dateOrderAmbiguous={job.options.dateOrderAmbiguous}
          snapshotDate={job.options.snapshotDate}
          savedMappingName={job.options.savedMappingName}
          today={todayIn(ctx.timezone)}
        />
      </Panel>
      <Panel title="First rows of your file" bodyClassName="p-0">
        <Table minWidth={Math.max(600, headers.length * 120)}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <Th key={i}>{h || `Column ${i + 1}`}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((r, i) => (
              <tr key={i}>
                {headers.map((_, j) => (
                  <Td key={j} className="whitespace-nowrap">{r[j] ?? ""}</Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <ConfirmAction action={cancelImportAction} hidden={{ jobId: job.id }} label="Cancel import" title="Cancel this import?" body="Nothing from this file has been saved. You can upload it again later." confirmLabel="Cancel import" />
    </div>
  );
}

async function ReviewStep({ job, ctx }: { job: Job; ctx: Ctx }) {
  const s = job.summary!;
  const issues = await tx(ctx, (db) => listIssues(db, ctx.businessId, job.id, 200));
  const preview = await tx(ctx, (db) => normalizedPreview(db, ctx, job, 25));
  const previous = await tx(ctx, (db) => previousImportOfSameFile(db, ctx.businessId, job));
  const fields = fieldsFor(job.kind).filter((f) => job.mapping?.[f.key] !== null && job.mapping?.[f.key] !== undefined);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="space-y-6">
      {previous && (
        <Alert tone="warn" title="This exact file was imported before">
          It was imported on {formatDate(new Date(previous.committed_at))}. Importing again is safe —{" "}
          {job.kind === "stock_snapshot" ? "stock that already matches is left unchanged" : job.kind === "sales" || job.kind === "purchases" ? "lines already imported are skipped, not doubled" : "existing records are updated, not duplicated"}.
        </Alert>
      )}
      <Panel title="Summary">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <SummaryStat label="Rows read" value={s.totalRows} />
          <SummaryStat label="Ready to import" value={s.valid} tone="ok" />
          <SummaryStat label="Rows with errors" value={s.errors} tone={s.errors ? "danger" : undefined} />
          <SummaryStat label="Skipped" value={s.skipped} />
          {job.kind === "products" ? (
            <>
              <SummaryStat label="New products" value={s.creates} />
              <SummaryStat label="Updated products" value={s.updates} />
            </>
          ) : job.kind === "suppliers" ? null : (
            <>
              <SummaryStat label="Products" value={s.distinctProducts} />
              <SummaryStat label={job.kind === "stock_snapshot" ? "Total quantity" : "Total units"} value={formatQty(s.totalQuantity)} />
            </>
          )}
        </dl>
        {s.dateFrom && (
          <p className="mt-4 text-sm text-muted">
            Dates from {formatDate(s.dateFrom)} to {formatDate(s.dateTo)}.
          </p>
        )}
        <div className="mt-5 rounded-md bg-paper px-4 py-3 text-sm text-text/80">
          {job.kind === "stock_snapshot" && <>Each listed product&apos;s stock will be set to the counted quantity as on {formatDate(job.options.snapshotDate)}; the difference is recorded in the stock ledger. Products not in the file are not changed.</>}
          {job.kind === "sales" && <>Sales are used to measure demand. They do not reduce your stock — your stock comes from stock counts and goods receipts.</>}
          {job.kind === "purchases" && <>Purchases are stored as price and supplier history. They do not add stock — confirm goods receipts or import a stock count for that.</>}
          {job.kind === "products" && <>Existing products (matched by SKU) are updated with the columns in this file; blank cells keep their current values.{job.options.recordStock ? ` Stock will be recorded as on ${formatDate(job.options.snapshotDate)}.` : ""}</>}
          {job.kind === "suppliers" && <>Suppliers are matched by name; blank cells keep current values.</>}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {s.valid > 0 ? (
            <ActionForm action={commitImportAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <SubmitButton pendingLabel="Importing…">
                Import {s.valid} row{s.valid === 1 ? "" : "s"}
                {s.errors ? `, skip ${s.errors} with errors` : ""}
              </SubmitButton>
            </ActionForm>
          ) : (
            <Alert tone="danger">No rows are ready to import. Fix the problems below in your file and upload it again.</Alert>
          )}
          <ActionForm action={editMappingAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton variant="secondary">Change column matching</SubmitButton>
          </ActionForm>
          {issues.length > 0 && <a href={`/api/imports/${job.id}/errors`} className={buttonClass("secondary")}>Download problem report</a>}
        </div>
      </Panel>

      {issues.length > 0 && (
        <Panel title={`Problems found (${s.errors} error rows, ${s.warnings} warnings)`} description={issues.length >= 200 ? "Showing the first 200 — download the report for all." : undefined} bodyClassName="p-0">
          <Table minWidth={640}>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Type</Th>
                <Th>Problem</Th>
                <Th>Value</Th>
              </tr>
            </thead>
            <tbody>
              {[...errors, ...warnings].map((i, n) => (
                <tr key={n}>
                  <Td className="num">{i.row_number}</Td>
                  <Td>{i.severity === "error" ? <Badge tone="danger">Error — row skipped</Badge> : <Badge tone="warn">Warning</Badge>}</Td>
                  <Td>{i.message}</Td>
                  <Td className="text-muted">{i.raw_value ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <Panel title="Preview of what will be saved" description="The first rows after cleaning — numbers parsed, units converted, dates read." bodyClassName="p-0">
        {preview.length === 0 ? (
          <p className="p-5 text-sm text-muted">No valid rows.</p>
        ) : (
          <Table minWidth={Math.max(600, fields.length * 120)}>
            <thead>
              <tr>
                <Th>Row</Th>
                {fields.map((f) => (
                  <Th key={f.key}>{f.label}</Th>
                ))}
                {"_baseQty" in (preview[0]?.record ?? {}) && <Th align="right">Base quantity</Th>}
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.rowNumber}>
                  <Td className="num text-muted">{r.rowNumber}</Td>
                  {fields.map((f) => (
                    <Td key={f.key} className="whitespace-nowrap">{r.record[f.key] === null || r.record[f.key] === undefined ? <span className="text-faint">—</span> : String(r.record[f.key])}</Td>
                  ))}
                  {"_baseQty" in r.record && <Td align="right">{formatQty(r.record._baseQty as number)}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function DoneStep({ job }: { job: Job }) {
  const committed = job.summary?.committed ?? {};
  return (
    <Panel title="Import complete" description={job.committed_at ? `Completed ${new Date(job.committed_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : undefined}>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        {Object.entries(committed).map(([k, v]) => (
          <SummaryStat key={k} label={RESULT_LABELS[k] ?? k} value={v} />
        ))}
        {job.error_count ? <SummaryStat label="Rows skipped with errors" value={job.error_count} tone="danger" /> : null}
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">
        <LinkButton href="/app/dashboard">Go to dashboard</LinkButton>
        <LinkButton href="/app/imports/new" variant="secondary">Import another file</LinkButton>
        {job.error_count ? <a href={`/api/imports/${job.id}/errors`} className={buttonClass("secondary")}>Download skipped rows</a> : null}
        <Link href={`/app/inventory`} className={buttonClass("ghost")}>View products</Link>
      </div>
    </Panel>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "danger" }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num mt-0.5 text-xl font-semibold ${tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
