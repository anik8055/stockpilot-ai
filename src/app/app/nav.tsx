"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const SECTIONS: { label: string; items: { href: string; label: string }[] }[] = [
  { label: "Overview", items: [{ href: "/app/dashboard", label: "Dashboard" }, { href: "/app/analytics", label: "Stock analysis" }, { href: "/app/reports", label: "Reports" }] },
  {
    label: "Stock",
    items: [{ href: "/app/inventory", label: "Products" }, { href: "/app/imports", label: "Imports" }],
  },
  {
    label: "Buying",
    items: [
      { href: "/app/purchasing", label: "Purchase list" },
      { href: "/app/purchase-orders", label: "Purchase orders" },
      { href: "/app/invoices", label: "Supplier invoices" },
      { href: "/app/suppliers", label: "Suppliers" },
    ],
  },
  { label: "Help", items: [{ href: "/app/assistant", label: "Ask StockPilot" }, { href: "/app/settings", label: "Settings" }] },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav aria-label="App" className="flex-1 overflow-y-auto px-3 pb-4">
      {SECTIONS.map((s) => (
        <div key={s.label} className="mt-3 first:mt-1">
          <p className="px-2 pb-1 text-xs text-[#8195b3]">{s.label}</p>
          <ul>
            {s.items.map((i) => {
              const active = path === i.href || path.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-2 py-1.5 text-sm ${active ? "bg-ink-3 font-medium text-white" : "text-[#c9d6ea] hover:bg-ink-2 hover:text-white"}`}
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function MobileShell({ sidebar, businessName, children }: { sidebar: ReactNode; businessName: string; children: ReactNode }) {
  // The menu is "open for" the path it was opened on, so navigating closes it without an effect.
  const path = usePathname();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === path;
  const setOpen = (v: boolean) => setOpenFor(v ? path : null);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 hidden h-screen bg-ink lg:block">{sidebar}</aside>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-3 bg-ink px-4 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ink-3 text-white">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" /></svg>
        </button>
        <span className="truncate text-sm font-medium text-white">{businessName}</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
