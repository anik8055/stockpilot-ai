import type { Metadata } from "next";
import { billingConfigured } from "@/lib/services/billing";
import { connection } from "next/server";
import { LinkButton } from "@/components/ui";
import { getPublicPlans, type PublicPlan } from "@/lib/services/public";

export const metadata: Metadata = { title: "Pricing" };

const FEATURE_ROWS: { key: keyof PublicPlan["features"]; label: string }[] = [
  { key: "reorder_engine", label: "Reorder recommendations" },
  { key: "supplier_analysis", label: "Supplier price comparison" },
  { key: "assistant", label: "Ask StockPilot (AI assistant)" },
  { key: "invoice_extraction", label: "Supplier invoice reading" },
  { key: "advanced_reports", label: "Advanced weekly report" },
];

export default async function PricingPage() {
  await connection();
  const plans = await getPublicPlans();
  const inr = new Intl.NumberFormat("en-IN");
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold sm:text-4xl">Pricing</h1>
        <p className="mt-4 text-lg text-muted">Start with a 14-day trial that includes Growth features and a small AI allowance. Choose a plan when you are ready.</p>
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {plans.map((p) => {
          const featured = p.code === "growth";
          return (
            <section key={p.code} className={`flex flex-col rounded-lg border bg-surface p-6 ${featured ? "border-ink ring-1 ring-ink" : "border-line"}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">{p.name}</h2>
                {featured && <span className="rounded-sm bg-ink px-2 py-0.5 text-xs font-medium text-white">Most complete</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
              <p className="mt-5">
                {p.isCustomPrice || p.priceInrMonthly === null ? (
                  <span className="text-3xl font-semibold text-ink">Custom</span>
                ) : (
                  <>
                    <span className="num text-3xl font-semibold text-ink">₹{inr.format(p.priceInrMonthly)}</span>
                    <span className="text-muted"> / month</span>
                  </>
                )}
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                <Li>Up to {inr.format(p.limits.max_products)} products</Li>
                <Li>
                  {p.limits.max_members} team member{p.limits.max_members === 1 ? "" : "s"}
                </Li>
                <Li>{inr.format(p.limits.imports_per_month)} imports a month</Li>
                {p.limits.ai_requests_per_month > 0 && <Li>{inr.format(p.limits.ai_requests_per_month)} AI questions a month</Li>}
                {p.limits.invoice_extractions_per_month > 0 && <Li>{inr.format(p.limits.invoice_extractions_per_month)} invoices read a month</Li>}
                {FEATURE_ROWS.map((f) => (
                  <Li key={f.key} off={!p.features[f.key]}>
                    {f.label}
                  </Li>
                ))}
                <Li>Low-stock alerts, imports, weekly report</Li>
              </ul>
              <div className="mt-auto pt-6">
                {p.isCustomPrice ? (
                  <LinkButton href="/contact?plan=business" variant="secondary" className="w-full">
                    Talk to us
                  </LinkButton>
                ) : (
                  <LinkButton href="/signup" variant={featured ? "primary" : "secondary"} className="w-full">
                    Start free trial
                  </LinkButton>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-10 max-w-3xl space-y-2 text-sm text-muted">
        <p>Prices are indicative and exclude GST. They may change before general availability; existing customers will be told in advance.</p>
        {billingConfigured() ? (
          <p>Starter and Growth can be bought online from Settings → Plan &amp; usage (owners only). Payments are handled by Razorpay; subscriptions renew monthly until you cancel.</p>
        ) : (
          <p>Online payment is not yet enabled. After your trial we will contact you to activate a plan, or you can continue on Starter features.</p>
        )}
      </div>
    </div>
  );
}

function Li({ children, off }: { children: React.ReactNode; off?: boolean }) {
  return (
    <li className={`flex gap-2 ${off ? "text-faint" : "text-text"}`}>
      <span aria-hidden className={`mt-0.5 ${off ? "text-faint" : "text-ok"}`}>
        {off ? "–" : "✓"}
      </span>
      <span>
        {off && <span className="sr-only">Not included: </span>}
        {children}
      </span>
    </li>
  );
}
