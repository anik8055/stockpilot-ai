// Local stand-in for Razorpay's Subscriptions API and hosted payment page, used only by the Playwright suite.
// It signs webhooks exactly like Razorpay (HMAC-SHA256 of the raw body with the webhook secret).
import { createHmac } from "node:crypto";
import http from "node:http";

const port = Number(process.env.MOCK_RAZORPAY_PORT ?? 3199);
const app = process.env.MOCK_RAZORPAY_APP_URL ?? "http://localhost:3100";
const keyAuth = `Basic ${Buffer.from("rzp_test_e2e:e2e_key_secret").toString("base64")}`;
const webhookSecret = "e2e_webhook_secret";
const subs = new Map();
let n = 0;
let evt = 0;

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

async function webhook(event, sub) {
  const body = JSON.stringify({ entity: "event", event, contains: ["subscription"], payload: { subscription: { entity: sub } }, created_at: Math.floor(Date.now() / 1000) });
  const sig = createHmac("sha256", webhookSecret).update(body).digest("hex");
  const r = await fetch(`${app}/api/billing/razorpay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": `evt_e2e_${Date.now().toString(36)}_${++evt}` }, body });
  if (!r.ok) console.error("webhook failed", r.status, await r.text());
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  if (url.pathname.startsWith("/v1/")) {
    if (req.headers.authorization !== keyAuth) return json(res, 401, { error: { description: "Authentication failed" } });
    const body = req.method === "POST" ? JSON.parse((await read(req)) || "{}") : {};
    if (req.method === "POST" && url.pathname === "/v1/subscriptions") {
      const id = `sub_E2E${Date.now().toString(36).toUpperCase()}${++n}`; // unique across mock restarts, like real IDs
      const sub = { id, entity: "subscription", plan_id: body.plan_id, status: "created", current_end: null, short_url: `http://localhost:${port}/pay/${id}`, notes: body.notes };
      subs.set(id, sub);
      return json(res, 200, sub);
    }
    const m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)(\/cancel)?$/);
    const sub = m && subs.get(m[1]);
    if (!sub) return json(res, 400, { error: { description: "The id provided does not exist" } });
    if (m[2] && req.method === "POST") {
      if (!body.cancel_at_cycle_end) sub.status = "cancelled";
      return json(res, 200, sub);
    }
    return json(res, 200, sub);
  }
  const pay = url.pathname.match(/^\/pay\/([^/]+)$/);
  if (pay && subs.has(pay[1])) {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>Test payment</title><h1>Test payment page</h1><p>Simulated Razorpay checkout for ${pay[1]}.</p><form method="post"><button>Pay (test)</button></form>`);
    }
    const sub = subs.get(pay[1]);
    Object.assign(sub, { status: "active", current_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
    await webhook("subscription.authenticated", sub);
    await webhook("subscription.activated", sub);
    res.writeHead(303, { location: `${app}/app/settings?tab=plan` });
    return res.end();
  }
  json(res, 404, { error: "not found" });
}).listen(port, () => console.log(`mock razorpay on ${port}`));
