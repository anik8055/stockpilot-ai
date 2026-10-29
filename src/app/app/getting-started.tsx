import Link from "next/link";
import { Badge, EmptyState, LinkButton } from "@/components/ui";

export function GettingStarted({ step }: { step: number }) {
  const steps = [
    { title: "Import your item list", body: "Product master from your billing system — codes, names, units, prices.", href: "/app/imports/new?kind=products" },
    { title: "Import closing stock", body: "Stock summary as on a date, or a physical count.", href: "/app/imports/new?kind=stock_snapshot" },
    { title: "Import item-wise sales", body: "Three to six months of sales register gives the best demand estimates.", href: "/app/imports/new?kind=sales" },
  ];
  return (
    <EmptyState title="Three imports to your first purchase list" action={<LinkButton href={steps[step].href}>Start with step {step + 1}</LinkButton>}>
      <ol className="mt-3 space-y-3 text-left">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <Badge tone={i < step ? "ok" : i === step ? "ink" : "neutral"}>{i + 1}</Badge>
            <span>
              <Link href={s.href} className="font-medium text-ink hover:text-signal">{s.title}</Link>
              <span className="block text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4">Want to look around first? Use <strong>Add workspace → Explore the demo workspace</strong> in the menu.</p>
    </EmptyState>
  );
}
