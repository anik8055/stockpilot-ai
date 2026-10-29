"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, buttonClass } from "@/components/ui";

export function UploadForm({ kind, maxMb }: { kind: string; maxMb: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file first.");
    if (file.size > maxMb * 1024 * 1024) return setError(`This file is larger than ${maxMb} MB. Export a shorter date range or remove unused columns.`);
    setBusy(true);
    try {
      const res = await fetch("/api/imports", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error ?? "Upload failed. Please try again.");
      router.push(`/app/imports/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <label
        htmlFor="file"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line-strong bg-paper px-6 py-10 text-center hover:border-signal hover:bg-signal-soft/40"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden className="text-muted">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-medium text-ink">{name ?? "Choose a CSV or Excel (.xlsx) file"}</span>
        <span className="text-xs text-muted">Up to {maxMb} MB. Nothing is saved to your data until you review and confirm.</span>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => setName(e.target.files?.[0]?.name ?? null)}
        />
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <button type="submit" disabled={busy} className={buttonClass("primary")}>
        {busy ? "Reading file…" : "Upload and check columns"}
      </button>
    </form>
  );
}
