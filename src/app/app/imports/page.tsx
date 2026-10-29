import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, EmptyState, LinkButton, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { IMPORT_KINDS, type ImportKind } from "@/lib/domain/imports/fields";
import { listImports } from "@/lib/services/imports";
import { requireTenant, tx } from "@/lib/tenant";

export const metadata: Metadata = { title: "Imports" };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" | "danger" | "info" }> = {
  uploaded: { label: "Needs column check", tone: "warn" },
  validated: { label: "Ready to review", tone: "info" },
  committed: { label: "Imported", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function ImportsPage(props: PageProps<"/app/imports">) {
  const t = await requireTenant();
  const { welcome } = await props.searchParams;
  const jobs = await tx(t, (db) => listImports(db, t.businessId));
  return (
    <>
      <PageHeader title="Imports" description="Bring in exports from your billing system. Every file is checked and previewed before anything is saved." actions={<LinkButton href="/app/imports/new">New import</LinkButton>} />
      {welcome && (
        <Alert tone="ok" title={`${t.business.name} is ready`} className="mb-6">
          Start by importing your item list, then closing stock, then item-wise sales. Templates are below if your export needs tidying.
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Import history" bodyClassName="p-0">
          {jobs.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No imports yet" action={<LinkButton href="/app/imports/new?kind=products">Import your item list</LinkButton>}>
                Most billing systems can export an item list, stock summary and sales register to Excel.
              </EmptyState>
            </div>
          ) : (
            <Table minWidth={640}>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th align="right">Rows</Th>
                  <Th>Uploaded</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-paper/60">
                    <Td>
                      <Link href={`/app/imports/${j.id}`} className="font-medium text-ink hover:text-signal">{j.original_filename}</Link>
                    </Td>
                    <Td className="text-muted">{IMPORT_KINDS[j.kind as ImportKind]?.label ?? j.kind}</Td>
                    <Td>
                      <Badge tone={STATUS[j.status]?.tone}>{STATUS[j.status]?.label ?? j.status}</Badge>
                    </Td>
                    <Td align="right">
                      {j.valid_count ?? "—"}
                      {j.error_count ? <span className="block text-xs text-danger">{j.error_count} with errors</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{new Date(j.created_at).toLocaleString("en-IN", { timeZone: t.business.timezone, dateStyle: "medium", timeStyle: "short" })}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Templates" description="Use these if your export needs reshaping. Your own column names usually work as they are.">
          <ul className="space-y-3 text-sm">
            {(Object.keys(IMPORT_KINDS) as ImportKind[]).map((k) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{IMPORT_KINDS[k].label}</span>
                <span className="flex gap-3">
                  <a className="text-signal hover:underline" href={`/api/imports/template?kind=${k}`}>Excel</a>
                  <a className="text-signal hover:underline" href={`/api/imports/template?kind=${k}&format=csv`}>CSV</a>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
