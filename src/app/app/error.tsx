"use client";

import { Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /permission/i.test(error.message);
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">{forbidden ? "You don't have access to this" : "This page could not be loaded"}</h1>
      <p className="mt-2 text-sm text-muted">
        {forbidden ? "Ask an owner or administrator of this workspace to change your role." : "Try again. If it keeps happening, note the reference below and contact support."}
      </p>
      {error.digest && <p className="mt-2 text-xs text-faint">Reference: {error.digest}</p>}
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
