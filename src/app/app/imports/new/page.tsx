import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { IMPORT_KINDS, type ImportKind } from "@/lib/domain/imports/fields";
import { env } from "@/lib/env";
import { requireTenant } from "@/lib/tenant";
import { UploadForm } from "../upload";

export const metadata: Metadata = { title: "New import" };

const ORDER: ImportKind[] = ["products", "stock_snapshot", "sales", "purchases", "suppliers"];
const EXAMPLES: Record<ImportKind, string> = {
  products: "Tally: Stock Item list · Busy/Marg: Item master",
  stock_snapshot: "Tally: Stock Summary · physical count sheet",
  sales: "Tally: Sales register (item-wise) · Busy: Item-wise sales",
  purchases: "Tally: Purchase register (item-wise)",
  suppliers: "Ledger list of sundry creditors",
};

export default async function NewImportPage(props: PageProps<"/app/imports/new">) {
  await requireTenant("imports.run");
  const { kind: k } = await props.searchParams;
  const kind = (typeof k === "string" && k in IMPORT_KINDS ? k : "products") as ImportKind;
  return (
    <>
      <PageHeader back={{ href: "/app/imports", label: "Imports" }} title="New import" description="Step 1 of 4 — choose what the file contains and upload it." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <nav aria-label="Import type">
          <ul className="space-y-2">
            {ORDER.map((key) => (
              <li key={key}>
                <Link
                  href={`?kind=${key}`}
                  aria-current={key === kind ? "true" : undefined}
                  className={`block rounded-lg border px-4 py-3 ${key === kind ? "border-ink bg-surface ring-1 ring-ink" : "border-line bg-surface hover:border-line-strong"}`}
                >
                  <span className="font-medium text-ink">{IMPORT_KINDS[key].label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{EXAMPLES[key]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Panel title={IMPORT_KINDS[kind].label} description={IMPORT_KINDS[kind].description}>
          <UploadForm key={kind} kind={kind} maxMb={env().MAX_IMPORT_FILE_MB} />
          <p className="mt-4 text-sm text-muted">
            Need a starting point? Download the <a className="text-signal hover:underline" href={`/api/imports/template?kind=${kind}`}>Excel template</a> or <a className="text-signal hover:underline" href={`/api/imports/template?kind=${kind}&format=csv`}>CSV template</a>.
          </p>
        </Panel>
      </div>
    </>
  );
}
