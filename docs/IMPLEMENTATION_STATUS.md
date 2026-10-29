# Implementation status

Persistent checklist for the master build prompt. Legend: **Done** = implemented and covered by automated tests;
**Done (manual)** = implemented and checked by hand/screenshots only; **Blocked** = needs your account, credentials or a
device; **Not built** = deliberately left out.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: Next.js, Postgres schema + RLS, auth, workspaces, roles, marketing site, onboarding | Done |
| 2 | Catalogue, units, aliases, CSV/XLSX import engine (mapping, preview, validation, error report, templates, saved mappings, idempotency) | Done |
| 3 | Dashboard, demand estimate, reorder engine, slow/non-moving/excess analysis, drill-downs, exports | Done |
| 4 | Suppliers, purchase lists, draft POs, PO PDF, goods receipts (partial, idempotent) | Done |
| 5 | Invoice extraction (PDF text, rules, optional AI, OCR optional), review, draft receipts; Ask StockPilot; weekly reports | Done |
| 6 | Plans/entitlements, quotas, AI cost controls, settings, audit log, deletion, tests, CI, Docker, deployment docs | Done |
| 7 | Capacitor Android project | Done (code) — **APK not built, not device-tested** (Android SDK downloads blocked in the build environment) |
| 8 | Final audit | See README *Test results* |

## Feature checklist

| Requirement | Status | Notes |
|---|---|---|
| Marketing site, pricing (indicative ₹2,499 / ₹4,999 / custom), contact/demo request | Done | No testimonials, customer counts or savings claims |
| Sign-up, sign-in, sign-out, password reset | Done | Reset emails need an email provider in production |
| Multi-tenant workspaces, owner/admin/staff, join codes, workspace switching | Done | RLS tested in `tenant-isolation.test.ts` |
| Product catalogue: SKU, barcode, aliases, units/conversions, costs, min/max, lead time, safety stock, CSV export | Done | |
| Import engine: products, stock snapshot, sales, purchases, suppliers; snapshot vs movement distinction; uncertain columns must be confirmed | Done | `.xls` (old binary) rejected with instructions |
| Dashboard with definitions and drill-down | Done | |
| Reorder engine with reasoning, provisional fallbacks, stockout-censored demand, inbound once, never auto-orders | Done | |
| Slow/non-moving/excess with 30/60/90/180 windows; "no recorded sales" ≠ non-moving | Done | |
| Purchasing: suppliers, draft POs, PDF, statuses, partial receipts, ledger | Done | PO "sent" is a status; no email sending of POs |
| AI invoice extraction with checks, matching, duplicates, editable review, stock only after confirmation | Done | Scanned/photo invoices need `OCR_PROVIDER=tesseract_cli` (Docker) |
| Ask StockPilot: server tools, deterministic numbers, validated output, works without AI | Done | Live Groq call **not** tested (no key); provider tested with a stub |
| Weekly report: web, PDF, CSV, assumptions; no fake scheduling | Done | Generated on demand; no scheduled email |
| Plan entitlements enforced server-side, trial, usage quotas | Done | |
| Payments | **Not built** | Plans changed manually (SQL in DEPLOYMENT.md); Razorpay is the next step |
| AI cost controls: quotas, row caps, token caps, timeout, usage log | Done | |
| Tests: unit, integration (real Postgres), e2e (Playwright) | Done | |
| Docker image, CI workflow | Written | Docker build not run here; CI not run on GitHub (no remote) |
| S3 storage driver | Written | **Not tested against a live bucket** |
| Android (Capacitor) | Written | Not built, not on a device, not published |

## Needs you

1. Hosting account (Vercel Pro or a Docker host), domain and DNS.
2. Managed Postgres (e.g. Supabase Pro) and a private S3-compatible bucket.
3. Optional: Groq API key and a current production model ID.
4. Email provider (Resend) for password-reset emails.
5. Razorpay account, if you want online payments.
6. Legal review of `/terms` and `/privacy` (written as plain-language drafts, not legal advice); GST registration on invoices you issue.
7. Penetration test / security review before taking real customer data.
8. Android Studio to build, sign and device-test the app; a Google Play developer account.
