import { NextResponse } from "next/server";
import { logError } from "@/lib/errors";
import { handleRazorpayWebhook } from "@/lib/services/billing";

/** Razorpay webhook endpoint. Configure in Razorpay → Settings → Webhooks with the subscription.* events. */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 1_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
    const r = await handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
    return NextResponse.json({ result: r.message }, { status: r.status });
  } catch (err) {
    // 5xx makes Razorpay retry later (e.g. when its API or our database was briefly unreachable).
    logError("billing.webhook", err);
    return NextResponse.json({ error: "temporary failure" }, { status: 503 });
  }
}
