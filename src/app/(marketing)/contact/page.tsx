import type { Metadata } from "next";
import { ContactForm } from "./form";

export const metadata: Metadata = { title: "Contact & demo" };

export default function ContactPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <h1 className="text-3xl font-semibold sm:text-4xl">Book a demo</h1>
        <p className="mt-4 text-lg text-muted">Tell us a little about your business. We&apos;ll walk you through StockPilot using your own exports, or the demo data if you prefer.</p>
        <ul className="mt-8 space-y-3 text-sm text-muted">
          <li>We reply by email, usually within a few working days.</li>
          <li>Bring a recent stock summary and sales register if you can — that makes the demo far more useful.</li>
          <li>We only use your details to reply to you.</li>
        </ul>
      </div>
      <div className="rounded-lg border border-line bg-surface p-6">
        <ContactForm />
      </div>
    </div>
  );
}
