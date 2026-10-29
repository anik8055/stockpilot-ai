# StockPilot AI — Product Requirements (MVP)

## Problem
Small and medium Indian wholesalers, distributors, hardware/electrical suppliers and auto spare-parts dealers
already run billing in Tally, Busy, Marg, Vyapar or Excel. Those tools record transactions well but do not answer:

- What should I reorder this week, and how much?
- What stock is not moving, and how much money is stuck in it?
- Which supplier do I buy from, at what price, and what is already on order?

## Value proposition
"Know what to reorder, what is gathering dust, and where your money is stuck in inventory."

StockPilot sits *beside* the existing billing system. Customers import exports (Excel/CSV) they already have;
StockPilot never requires migrating billing or accounting.

## Target user
Owner or purchase manager of a 1–50 person trading business. Comfortable with Excel and WhatsApp, not with
software jargon. Uses a phone as much as a laptop.

## MVP scope (must work end-to-end)
| Area | Outcome |
|---|---|
| Accounts & workspaces | Sign up, sign in/out, password reset, create/join a business workspace, roles (owner/admin/staff), workspace switching |
| Catalogue | Products with SKU, barcode, aliases/supplier codes, units & conversions, costs, prices, min/max, lead time, safety stock |
| Imports | CSV/XLSX upload → header detection → mapping (with confirmation of ambiguous fields) → preview → validation → summary → confirm → error report. Products, stock snapshots, sales history, purchase history, suppliers |
| Stock ledger | Immutable movement ledger; snapshot imports reconcile by delta; sales history never double-reduces stock |
| Dashboard | Data-backed KPIs with definitions, time ranges and drill-down |
| Reorder engine | Deterministic, explained, provisional when data is thin, never negative, inbound counted once |
| Slow/non-moving/excess | Configurable windows (30/60/90/180), exact rule shown, "no recorded sales" ≠ "confirmed non-moving" |
| Purchasing | Suppliers, supplier prices/MOQ/lead time, recommendation → editable draft PO, PO PDF, statuses, goods receipt (partial), idempotent stock posting |
| Invoices | Upload PDF/image → extract (text layer, optional LLM structuring, optional OCR) → arithmetic validation → SKU matching → editable review → draft goods receipt |
| Ask StockPilot | Q&A grounded in the workspace's data via server-side tools; numbers come from deterministic services; works (in reduced form) with AI disabled |
| Reports | Weekly inventory report: web view, PDF, CSV; configurable period; assumptions and data gaps listed |
| Plans | Starter/Growth/Business entitlements enforced server-side; indicative INR pricing; trial |

## Explicit non-goals for MVP
- Replacing billing, GST filing or accounting.
- Automatically placing orders, emailing suppliers or making payments.
- Scheduled/emailed reports (designed, not enabled until an email provider is configured).
- Live payment collection (requires Razorpay credentials; architecture documented).

## Honesty rules
- No fabricated testimonials, customer counts or savings claims anywhere.
- Demo workspace data is synthetic and labelled as such in the UI.
- Pricing shown is indicative (₹2,499 Starter / ₹4,999 Growth / custom Business), configurable server-side.
