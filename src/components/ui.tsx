import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ buttons */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variantClass: Record<Variant, string> = {
  primary: "bg-signal text-white hover:bg-signal-strong disabled:bg-signal/50",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-info-soft disabled:text-faint",
  ghost: "text-ink hover:bg-info-soft disabled:text-faint",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50",
};
const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
    variantClass[variant],
    sizeClass[size],
    extra,
  );
}

export function Button({ variant = "primary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

/* ------------------------------------------------------------------ form fields */

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-text placeholder:text-faint focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/20 disabled:bg-paper aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(inputBase, "h-10", className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={cn(inputBase, "h-10 pr-8", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(inputBase, "min-h-24 py-2", className)} />;
}

/* ------------------------------------------------------------------ surfaces */

export function Panel({ title, description, actions, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {back && (
          <Link href={back.href} className="mb-2 inline-block text-sm text-muted hover:text-ink">
            ‹ {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1.5 text-[0.95rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "ink";
const toneClass: Record<Tone, string> = {
  neutral: "bg-info-soft text-muted border-line",
  info: "bg-signal-soft text-signal-strong border-signal/20",
  ok: "bg-ok-soft text-ok border-ok/20",
  warn: "bg-warn-soft text-warn border-warn/25",
  danger: "bg-danger-soft text-danger border-danger/20",
  ink: "bg-ink text-white border-ink",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: Exclude<Tone, "ink" | "neutral"> | "neutral"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const role = tone === "danger" ? "alert" : "status";
  return (
    <div role={role} className={cn("rounded-md border px-4 py-3 text-sm", toneClass[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "text-text/80")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-5 py-8 sm:items-center sm:text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A KPI with its definition one click away. `href` drills down to the underlying products. */
export function Metric({ label, value, sub, definition, href, tone = "neutral" }: { label: string; value: ReactNode; sub?: ReactNode; definition: ReactNode; href?: string; tone?: "neutral" | "warn" | "danger" | "ok" }) {
  const bar = { neutral: "bg-line-strong", warn: "bg-warn", danger: "bg-danger", ok: "bg-ok" }[tone];
  const body = (
    <>
      <span className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r", bar)} aria-hidden />
      <span className="block text-sm text-muted">{label}</span>
      <span className="num mt-1 block text-2xl font-semibold text-ink">{value}</span>
      {sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}
    </>
  );
  return (
    <div className="relative flex flex-col rounded-lg border border-line bg-surface">
      {href ? (
        <Link href={href} className="relative block px-4 pt-3 pb-2 hover:bg-paper/60">
          {body}
        </Link>
      ) : (
        <div className="relative px-4 pt-3 pb-2">{body}</div>
      )}
      <details className="group border-t border-line px-4 py-1.5 text-xs text-muted">
        <summary className="cursor-pointer list-none select-none hover:text-ink">
          <span className="group-open:hidden">How is this calculated?</span>
          <span className="hidden group-open:inline">Hide definition</span>
        </summary>
        <div className="pt-1 pb-1 leading-relaxed">{definition}</div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ tables */

export function Table({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("-mx-4 overflow-x-auto sm:mx-0", className)}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, align = "left", ...rest }: ComponentProps<"th"> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      {...rest}
      className={cn("border-b border-line-strong bg-paper px-3 py-2 text-xs font-semibold text-muted first:pl-4 last:pr-4", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left", className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, className, align = "left", ...rest }: ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
  return (
    <td {...rest} className={cn("border-b border-line px-3 py-2.5 align-top first:pl-4 last:pr-4", align === "right" ? "num text-right" : align === "center" ? "text-center" : "", className)}>
      {children}
    </td>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted">{children}</p>;
}
