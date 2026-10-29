import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/ui";

type FeaturePage = { title: string; intro: string; sections: { heading: string; body: string[] }[]; limits: string[] };

const FEATURES: Record<string, FeaturePage> = {
  "inventory-intelligence": {
    title: "Inventory intelligence",
    intro: "A dashboard built from your own stock and sales data — every number has a definition, a time range and a list of the items behind it.",
    sections: [
      {
        heading: "See the position of every item",
        body: [
          "Active items, units in stock and stock value at cost, updated each time you import a stock balance or receive goods.",
          "Low-stock and out-of-stock items, with how many days of stock remain at the current rate of sale.",
        ],
      },
      {
        heading: "Find money stuck in stock",
        body: [
          "Non-moving items (no sales across the whole 30, 60, 90 or 180-day window you choose) and slow movers below a sales rate you set.",
          "Excess stock: quantity beyond what you would sell in your chosen coverage period, valued at cost.",
          "If your sales history is shorter than the window, items are marked “no recorded sales” rather than called dead stock.",
        ],
      },
      {
        heading: "Spot data problems early",
        body: ["Possible duplicate items (same description written differently, or the same part number), sudden purchase-price jumps, and stale imports are listed so you can fix them at the source."],
      },
    ],
    limits: ["Accuracy depends on how complete your imported sales history is.", "Demand during days an item was out of stock cannot be measured and is excluded from averages."],
  },
  "purchase-planning": {
    title: "Purchase planning",
    intro: "A purchase list you can explain to your partner or your accountant: each suggestion shows the formula, the inputs and the data quality behind it.",
    sections: [
      {
        heading: "Reorder points from real demand",
        body: [
          "Reorder point = average daily sales × supplier lead time + safety stock. Suggested quantity tops you up to your chosen days of cover.",
          "Stock already ordered from suppliers is counted once, so you don't order the same goods twice.",
          "Quantities are rounded up to box or pack sizes and the supplier's minimum order.",
        ],
      },
      {
        heading: "From suggestion to purchase order",
        body: [
          "Group suggestions by supplier, edit quantities and prices, and create draft purchase orders.",
          "Download a printable PDF to send the way you already do — WhatsApp, email or in person. StockPilot never sends orders itself.",
          "Receive goods against the order, including partial deliveries. Stock updates only when you confirm the receipt.",
        ],
      },
    ],
    limits: ["New items with little history get a provisional suggestion based on your minimum stock, clearly labelled.", "Suggestions are advice. Nothing is ordered without you."],
  },
  "invoice-extraction": {
    title: "Supplier invoice reading",
    intro: "Upload a supplier's purchase invoice and get an editable list of lines to receive into stock — checked, matched and never posted without your confirmation.",
    sections: [
      {
        heading: "Read, check, match",
        body: [
          "Reads invoice number, date, supplier GSTIN, line items, quantities, rates, discounts, tax and totals from PDF invoices that contain text.",
          "Checks that quantity × rate matches each line and that lines add up to the invoice total, and warns when they don't.",
          "Matches lines to your items by supplier item code, part number or exact description. Uncertain matches are left for you to choose.",
          "Warns if the same invoice was uploaded before.",
        ],
      },
    ],
    limits: [
      "Scanned images and photos need an OCR service to be configured; until then StockPilot tells you it cannot read them instead of guessing.",
      "Unusual invoice layouts may need more manual correction on the review screen.",
    ],
  },
  reporting: {
    title: "Weekly inventory report",
    intro: "A short report for the owner every week — on screen, as a PDF to forward, or as CSV for your own analysis.",
    sections: [
      {
        heading: "What's in it",
        body: [
          "Items to review for reorder and current stockout risks.",
          "Slow-moving and excess stock, with the value tied up.",
          "Sales and purchase totals for the period compared with the previous period, where data exists for both.",
          "Supplier-wise purchasing needs and a list of data problems to fix.",
          "The assumptions and data gaps behind the numbers, written out in plain language.",
        ],
      },
    ],
    limits: ["Reports are generated when you ask for them. Scheduled email delivery is planned and will be switched on only once an email service is configured."],
  },
};

export function generateStaticParams() {
  return Object.keys(FEATURES).map((slug) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/features/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: FEATURES[slug]?.title ?? "Features" };
}

export default async function FeaturePage(props: PageProps<"/features/[slug]">) {
  const { slug } = await props.params;
  const f = FEATURES[slug];
  if (!f) notFound();
  const others = Object.entries(FEATURES).filter(([k]) => k !== slug);
  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold sm:text-4xl">{f.title}</h1>
        <p className="mt-4 text-lg text-muted">{f.intro}</p>
      </div>
      <div className="mt-12 grid gap-12 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-10">
          {f.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-xl font-semibold">{s.heading}</h2>
              <ul className="mt-3 space-y-2.5 text-[0.97rem] text-text/90">
                {s.body.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-hidden />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="rounded-lg border border-line bg-paper p-5">
            <h2 className="text-base font-semibold">Good to know</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
              {f.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
          <LinkButton href="/signup">Start free trial</LinkButton>
        </div>
        <aside>
          <p className="mb-3 text-sm font-semibold text-ink">Other features</p>
          <ul className="space-y-2 text-sm">
            {others.map(([k, o]) => (
              <li key={k}>
                <a href={`/features/${k}`} className="text-signal hover:underline">
                  {o.title}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
