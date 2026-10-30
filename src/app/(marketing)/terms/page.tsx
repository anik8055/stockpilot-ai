import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-3 [&_p]:text-text/90">
      <h1 className="text-3xl font-semibold">Terms of use</h1>
      <p className="text-muted">Early-access terms. These will be replaced by full terms before paid plans are offered.</p>
      <h2>The service</h2>
      <p>StockPilot analyses data you provide and suggests purchasing and stock actions. Suggestions are estimates based on your data and the settings you choose. You decide what to buy; StockPilot never places orders or makes payments for you.</p>
      <h2>Your data</h2>
      <p>You own the data you upload. You are responsible for having the right to upload it. You can export or delete it at any time, as described on the privacy page.</p>
      <h2>Trial and plans</h2>
      <p>The free trial lasts 14 days. After it ends, workspaces continue with Starter features until a paid plan is activated. Usage limits for each plan are shown on the pricing page.</p>
      <h2>Payments and cancellation</h2>
      <p>Paid plans bought online are monthly subscriptions processed by Razorpay and renew until cancelled. The workspace owner can cancel from Settings; the plan stays active until the end of the period already paid for, after which Starter features apply. No data is deleted when a plan ends.</p>
      <h2>Availability</h2>
      <p>We aim to keep the service available and your data safe, but during early access we cannot guarantee uninterrupted service. Keep your billing system as your record of accounts.</p>
    </article>
  );
}
