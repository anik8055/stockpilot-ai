import Link from "next/link";
import { LinkButton } from "@/components/ui";

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line bg-paper">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <h1 className="text-[2.1rem] leading-[1.12] font-semibold sm:text-5xl sm:leading-[1.08]">
              Know what to reorder, what is gathering dust, and where your money is stuck in stock.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              StockPilot reads the stock and sales exports you already have — from Tally, Busy, Marg or plain Excel — and turns them into a purchase list you can trust, with the
              reasoning shown for every item.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup" className="h-11 px-5 text-base">
                Start 14-day free trial
              </LinkButton>
              <LinkButton href="/contact" variant="secondary" className="h-11 px-5 text-base">
                Book a demo
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-muted">No card needed. Keep your billing software — StockPilot works alongside it.</p>
          </div>
          <SamplePurchaseList />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="max-w-2xl text-2xl font-semibold sm:text-3xl">Billing software records every sale. It doesn&apos;t tell you what to buy next.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          <Problem title="Fast movers run out">
            The 16A MCB that sells every day is out of stock on Saturday, and the next lot is a week away. Customers go to the shop down the road.
          </Problem>
          <Problem title="Slow stock eats your cash">
            Cartons of last season&apos;s fans sit in the godown. Nobody has added up how much money is locked in items that haven&apos;t sold in three months.
          </Problem>
          <Problem title="Purchase lists are guesswork">
            Orders are placed from memory or a quick walk around the racks, without checking what is already on order from the supplier.
          </Problem>
        </div>
      </section>

      <section className="border-y border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold sm:text-3xl">Up and running in an afternoon</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            <Step n={1} title="Export what you already have">
              Item list, closing stock and item-wise sales from your billing system. Excel or CSV, any column names.
            </Step>
            <Step n={2} title="Check the import">
              StockPilot matches your columns, shows every row it will add, and lists problems row by row before anything is saved.
            </Step>
            <Step n={3} title="Review the purchase list">
              See what to reorder and why, group it by supplier, adjust quantities and download purchase orders as PDF.
            </Step>
          </ol>
          <Link href="/how-it-works" className="mt-8 inline-block text-sm font-medium text-signal hover:underline">
            See the full workflow
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
          <Feature href="/features/inventory-intelligence" title="Inventory intelligence">
            Low-stock, out-of-stock, excess and non-moving items, each with the rule that flagged it and the value of stock involved.
          </Feature>
          <Feature href="/features/purchase-planning" title="Purchase planning">
            Reorder points from your real demand and supplier lead times, quantities rounded to box sizes and minimum orders, and supplier-wise draft POs.
          </Feature>
          <Feature href="/features/invoice-extraction" title="Supplier invoice reading">
            Upload a supplier&apos;s PDF invoice. StockPilot reads the lines, checks the arithmetic, matches items to your codes and lets you correct everything before receiving stock.
          </Feature>
          <Feature href="/features/reporting" title="Weekly inventory report">
            One page for the owner: what to order, stockout risks, slow stock value and data problems — on screen, as PDF or as CSV.
          </Feature>
        </div>
      </section>

      <section className="border-t border-line bg-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-semibold">What StockPilot will not do</h2>
            <p className="mt-3 text-muted">You stay in control of your money and your suppliers.</p>
          </div>
          <ul className="space-y-4 text-[0.95rem]">
            <Never>Place an order, message a supplier or make a payment on its own. Every purchase order is a draft until you act on it.</Never>
            <Never>Replace your billing or GST software. It reads exports; it does not file returns or issue invoices.</Never>
            <Never>Change your stock because a sales report was imported. Stock only changes from stock counts and goods you confirm as received.</Never>
            <Never>Let the AI assistant invent numbers. Figures come from your data and fixed formulas; the assistant only explains them.</Never>
          </ul>
        </div>
      </section>

      <section className="bg-ink">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Try it on your own data</h2>
            <p className="mt-2 max-w-xl text-[#c9d6ea]">Or open the demo workspace — a fictional electricals wholesaler with six months of synthetic sales.</p>
          </div>
          <LinkButton href="/signup" className="h-11 bg-white px-5 text-base text-ink hover:bg-signal-soft">
            Create your workspace
          </LinkButton>
        </div>
      </section>
    </>
  );
}

function SamplePurchaseList() {
  const rows = [
    { name: "MCB 16A Double Pole", meta: "7 in stock · about 1 day left · 7-day lead time", order: "48 pcs (4 boxes)", value: "₹21,024", tone: "danger", status: "Order now" },
    { name: "FR Copper Wire 2.5 sqmm Red", meta: "540 m in stock · 11 days left · 90 m on order", order: "2 coils (180 m)", value: "₹6,760", tone: "warn", status: "Reorder" },
    { name: "Ceiling Fan 1200mm White", meta: "18 in stock · no sales in 90 days", order: "Don't reorder", value: "₹30,960 tied up", tone: "neutral", status: "Non-moving" },
  ] as const;
  const toneCls = { danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", neutral: "bg-info-soft text-muted" };
  return (
    <figure className="rounded-lg border border-line-strong bg-surface shadow-[0_1px_0_#dfe4ec,0_12px_32px_-18px_rgb(16_35_63_/_0.35)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">This week&apos;s purchase list</p>
        <span className="text-xs text-faint">Example · synthetic data</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={r.name} className="border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{r.name}</p>
                <p className="mt-0.5 text-xs text-muted">{r.meta}</p>
              </div>
              <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium ${toneCls[r.tone]}`}>{r.status}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between text-sm">
              <span className="text-text">{r.order}</span>
              <span className="num font-semibold text-ink">{r.value}</span>
            </div>
            {i === 0 && (
              <p className="mt-2 rounded-md bg-paper px-3 py-2 text-xs leading-relaxed text-muted">
                Why: reorder point 52 = 6.1 sold per day × 7-day lead time + 9 safety stock. You have 7 and nothing on order, so order up to 55 — rounded to full boxes of 12.
              </p>
            )}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-line-strong pl-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-muted">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">{n}</span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted">{children}</p>
    </li>
  );
}

function Feature({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group block">
      <h3 className="text-lg font-semibold group-hover:text-signal">{title}</h3>
      <p className="mt-1.5 text-muted">{children}</p>
      <span className="mt-2 inline-block text-sm font-medium text-signal">Learn more</span>
    </Link>
  );
}

function Never({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <svg width="20" height="20" viewBox="0 0 20 20" className="mt-0.5 shrink-0 text-ink" aria-hidden>
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 13.5l7-7" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
