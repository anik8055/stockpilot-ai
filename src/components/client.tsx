"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

export function SubmitButton({ children, pendingLabel, variant = "primary", size = "md", className, disabled }: { children: ReactNode; pendingLabel?: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/** Wraps a server action form; shows the result message and field errors. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: ReactNode | ((state: ActionResult | null) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} noValidate>
      {typeof children === "function" ? children(state) : children}
      <FormMessage state={state} />
    </form>
  );
}

export function FormMessage({ state }: { state: ActionResult | null }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`mt-3 rounded-md border px-3 py-2 text-sm ${state.ok ? "border-ok/20 bg-ok-soft text-ok" : "border-danger/20 bg-danger-soft text-danger"}`}>
      {state.message}
    </p>
  );
}

/** Button that opens a native confirmation dialog before submitting a server action form. */
export function ConfirmAction({
  action,
  label,
  title,
  body,
  confirmLabel,
  variant = "danger",
  size = "sm",
  hidden,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  label: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) ref.current?.close();
  }, [state]);
  return (
    <>
      <button type="button" className={buttonClass(variant === "danger" ? "secondary" : variant, size, variant === "danger" ? "text-danger" : undefined)} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref} className="m-auto w-[min(92vw,28rem)] rounded-lg border border-line bg-surface p-0 text-text shadow-xl" aria-labelledby="confirm-title">
        <form action={formAction} className="p-5">
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <h2 id="confirm-title" className="text-lg font-semibold">
            {title}
          </h2>
          <div className="mt-2 text-sm text-muted">{body}</div>
          <FormMessage state={state && !state.ok ? state : null} />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary", "md")} onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <SubmitButton variant={variant}>{confirmLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
