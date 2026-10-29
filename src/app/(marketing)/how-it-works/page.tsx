import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  {
    title: "Create your workspace",
    body: "Sign up, enter your business name and trade. Invite your purchase manager or staff later with a join code. Each business's data is kept separate.",
  },
  {
    title: "Import your item list",
    body: "Upload the item master from your billing system (Excel or CSV). StockPilot recognises common column names like Item Code, Stock Item, Part Number, UOM and Purchase Rate, and asks you to confirm any column it isn't sure about.",
  },
  {
    title: "Import closing stock",
    body: "Upload a stock summary or your physical count. StockPilot records the difference from what it had as an adjustment, so importing the same file twice changes nothing.",
  },
  {
    title: "Import item-wise sales",
    body: "Upload a sales register with dates and quantities — three to six months works best. Sales are used to measure demand only; they never reduce your stock a second time.",
  },
  {
    title: "Add suppliers and lead times",
    body: "Import or type your suppliers, how many days they take to deliver, their minimum order and box sizes. Better lead times mean better reorder points.",
  },
  {
    title: "Review and order",
    body: "Open the purchase list, read the reasoning, adjust quantities, and create supplier-wise draft POs. Download the PDF and send it the way you always do. Confirm receipts when goods arrive.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold sm:text-4xl">How StockPilot works</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">You keep billing in Tally, Busy, Marg or Excel. Every week or month, export a few reports and import them here.</p>
      <ol className="mt-12 space-y-0">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative grid grid-cols-[2.5rem_1fr] gap-4 pb-10 last:pb-0">
            {i < STEPS.length - 1 && <span className="absolute top-9 bottom-0 left-[1.2rem] w-px bg-line-strong" aria-hidden />}
            <span className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-surface font-semibold text-ink">{i + 1}</span>
            <div className="pt-1.5">
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="mt-1.5 text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-14 rounded-lg border border-line bg-paper p-6">
        <h2 className="text-lg font-semibold">Which reports to export</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
          <li>Item list / stock item master (codes, names, units, rates)</li>
          <li>Stock summary or closing stock as on a date</li>
          <li>Item-wise sales register for the last 3–6 months</li>
          <li>Optional: item-wise purchase register, supplier list</li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Sample templates are available in the import centre after you sign up. Not sure what to export? <Link href="/contact" className="text-signal hover:underline">Ask us</Link>.
        </p>
      </div>
      <div className="mt-10">
        <LinkButton href="/signup">Start free trial</LinkButton>
      </div>
    </div>
  );
}
