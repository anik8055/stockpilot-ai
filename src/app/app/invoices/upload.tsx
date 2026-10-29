"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, buttonClass } from "@/components/ui";

export function InvoiceUpload({ maxMb }: { maxMb: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        const f = fd.get("file");
        if (!(f instanceof File) || !f.size) return setError("Choose a file first.");
        if (f.size > maxMb * 1024 * 1024) return setError(`Invoices can be up to ${maxMb} MB.`);
        setBusy(true);
        try {
          const res = await fetch("/api/invoices", { method: "POST", body: fd });
          const json = (await res.json().catch(() => ({}))) as { id?: string; duplicateOf?: string; error?: string };
          if (!res.ok || !json.id) throw new Error(json.error ?? "Upload failed.");
          router.push(`/app/invoices/${json.id}${json.duplicateOf ? "?duplicate=1" : ""}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed.");
          setBusy(false);
        }
      }}
    >
      <label htmlFor="invoice-file" className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-line-strong bg-paper px-6 py-8 text-center hover:border-signal">
        <span className="font-medium text-ink">{name ?? "Choose a supplier invoice (PDF, or a photo if OCR is set up)"}</span>
        <span className="text-xs text-muted">Up to {maxMb} MB. Nothing changes in your stock until you confirm a goods receipt.</span>
        <input id="invoice-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => setName(e.target.files?.[0]?.name ?? null)} />
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <button type="submit" disabled={busy} className={buttonClass("primary")}>{busy ? "Reading invoice…" : "Upload and read"}</button>
    </form>
  );
}
