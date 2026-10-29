"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Alert, Badge, Field, Input, Select } from "@/components/ui";
import type { FieldDef } from "@/lib/domain/imports/fields";
import { validateImportAction } from "../actions";

type Props = {
  jobId: string;
  kind: string;
  fields: FieldDef[];
  headers: string[];
  mapping: Record<string, number | null>;
  confidence: Record<string, "exact" | "partial" | "none">;
  ambiguities: { field: string; message: string }[];
  kindHints: string[];
  preview: string[][];
  dateOrder?: string;
  dateOrderAmbiguous?: boolean;
  snapshotDate?: string;
  savedMappingName?: string | null;
  today: string;
};

export function MappingForm(p: Props) {
  const [mapping, setMapping] = useState(p.mapping);
  const used = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const [k, v] of Object.entries(mapping)) if (v !== null && v !== undefined) m.set(v, [...(m.get(v) ?? []), k]);
    return m;
  }, [mapping]);
  const ambiguous = new Set(p.ambiguities.map((a) => a.field));
  const hasQuantity = mapping.quantity !== null && mapping.quantity !== undefined;
  const [recordStock, setRecordStock] = useState(false);
  const needsDate = p.kind === "stock_snapshot" || (p.kind === "products" && recordStock);

  return (
    <ActionForm action={validateImportAction} className="space-y-6">
      <input type="hidden" name="jobId" value={p.jobId} />
      {p.kindHints.map((h) => (
        <Alert key={h} tone="warn" title="Is this the right kind of file?">{h}</Alert>
      ))}
      {p.savedMappingName && <Alert tone="info">Columns were filled in from your saved mapping “{p.savedMappingName}”. Check them before continuing.</Alert>}

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-paper text-left text-xs text-muted">
              <th scope="col" className="px-4 py-2 font-semibold">StockPilot field</th>
              <th scope="col" className="px-4 py-2 font-semibold">Column in your file</th>
              <th scope="col" className="hidden px-4 py-2 font-semibold md:table-cell">First values</th>
            </tr>
          </thead>
          <tbody>
            {p.fields.map((f) => {
              const v = mapping[f.key];
              const clash = v !== null && v !== undefined && (used.get(v)?.length ?? 0) > 1;
              const flagged = ambiguous.has(f.key) || clash;
              const samples = v === null || v === undefined ? [] : p.preview.slice(0, 3).map((r) => r[v] ?? "");
              return (
                <tr key={f.key} className={`border-t border-line ${flagged ? "bg-warn-soft/60" : ""}`}>
                  <td className="px-4 py-2.5 align-top">
                    <label htmlFor={`map_${f.key}`} className="font-medium text-ink">
                      {f.label}
                      {f.required && <span className="text-danger" aria-label="required"> *</span>}
                    </label>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {p.confidence[f.key] === "exact" && !flagged && <Badge tone="ok">Matched</Badge>}
                      {p.confidence[f.key] === "partial" && <Badge tone="warn">Check this</Badge>}
                      {clash && <Badge tone="danger">Column used twice</Badge>}
                    </div>
                    {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <Select
                      id={`map_${f.key}`}
                      name={`map_${f.key}`}
                      value={v === null || v === undefined ? "" : String(v)}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                      aria-invalid={clash}
                    >
                      <option value="">{f.required ? "— choose a column —" : "— not in this file —"}</option>
                      {p.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `(column ${i + 1}, no heading)`}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="hidden px-4 py-2.5 align-top text-xs text-muted md:table-cell">{samples.filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {p.ambiguities.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
          <p className="font-semibold text-warn">Please confirm these matches</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-text/80">
            {p.ambiguities.map((a) => (
              <li key={a.field}>{a.message}</li>
            ))}
          </ul>
          <label className="mt-3 flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" name="confirmMapping" className="h-4 w-4 accent-signal" /> I have checked the highlighted columns
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {p.kind === "products" && hasQuantity && (
          <label className="flex items-start gap-2 rounded-md border border-line p-3 text-sm sm:col-span-2">
            <input type="checkbox" name="recordStock" className="mt-0.5 h-4 w-4 accent-signal" checked={recordStock} onChange={(e) => setRecordStock(e.target.checked)} />
            <span>
              <span className="font-medium text-ink">Also record the stock column as a stock count</span>
              <span className="block text-muted">StockPilot will set each product&apos;s stock to this quantity (as on the date below). Leave unticked to import product details only.</span>
            </span>
          </label>
        )}
        {needsDate && (
          <Field label="Stock quantities are as on" htmlFor="snapshotDate" hint="Usually the date you exported the stock summary. Goods received after this date are kept.">
            <Input id="snapshotDate" name="snapshotDate" type="date" max={p.today} defaultValue={p.snapshotDate ?? p.today} required />
          </Field>
        )}
        {p.kind === "stock_snapshot" && mapping.unit_cost !== null && mapping.unit_cost !== undefined && (
          <label className="flex items-start gap-2 self-end rounded-md border border-line p-3 text-sm">
            <input type="checkbox" name="updateCosts" defaultChecked className="mt-0.5 h-4 w-4 accent-signal" />
            <span>Update product purchase costs from the cost column</span>
          </label>
        )}
        {mapping.date !== undefined && mapping.date !== null && (
          <Field
            label="Date format in this file"
            htmlFor="dateOrder"
            hint={p.dateOrderAmbiguous ? "All dates in the sample could be read either way (e.g. 03/04 = 3 April or 4 March). Please confirm." : "Detected from the dates in your file."}
          >
            <Select id="dateOrder" name="dateOrder" defaultValue={p.dateOrder ?? "dmy"}>
              <option value="dmy">Day / Month / Year (31/12/2026)</option>
              <option value="mdy">Month / Day / Year (12/31/2026)</option>
              <option value="ymd">Year-Month-Day (2026-12-31)</option>
            </Select>
          </Field>
        )}
      </div>

      <details className="rounded-md border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">Save this column mapping for next time</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="saveMapping" className="h-4 w-4 accent-signal" /> Save mapping as
          </label>
          <Input name="mappingName" aria-label="Mapping name" placeholder="e.g. Tally stock summary" className="max-w-xs" />
        </div>
        <p className="mt-2 text-xs text-muted">Files with the same column headings will be filled in automatically.</p>
      </details>

      <SubmitButton pendingLabel="Checking every row…">Check rows</SubmitButton>
    </ActionForm>
  );
}
