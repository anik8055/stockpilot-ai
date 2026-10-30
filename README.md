# StockPilot AI

Inventory intelligence for Indian wholesalers, distributors, hardware shops, electrical suppliers and automobile
spare-parts dealers. Customers import the Excel/CSV exports they already have (Tally, Busy, Marg or plain sheets) and see
what to reorder, what is not selling, and how much money is tied up in stock — without replacing their billing software.

> **Status:** working MVP, tested locally (see *Test results*). It has **not** been deployed anywhere; online payments
> are built but have not been run against Razorpay itself (only a local stand-in), and the Android project has been
> generated but not built or run on a device. See
> [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the full checklist.

## What it does

| Area | Highlights |
|---|---|
| Imports | CSV/XLSX, header-row detection under title rows, 100+ header synonyms, forced confirmation of uncertain columns, Indian number/date parsing, unit conversions, row-level error report, saved mappings, templates, idempotent re-imports |
| Stock ledger | Append-only movements; stock counts post the difference; sales history never reduces stock twice |
| Dashboard & analysis | Defined, drill-down metrics; low/out/excess/non-moving/slow stock with the exact rule; 30/60/90/180-day windows; duplicate and cost-jump detection |
| Reorder engine | `ROP = avg daily sales × lead time + safety stock`; stockout days excluded from demand; inbound counted once; MOQ/pack rounding; provisional fallbacks; reasoning shown |
| Purchasing | Supplier-wise draft POs, PO PDF, "mark as sent", partial/idempotent goods receipts |
| Supplier invoices | PDF text extraction → rule-based structuring → optional AI structuring of the text → arithmetic checks → conservative SKU matching → editable review → draft receipt |
| Ask StockPilot | Read-only data tools compute every figure; the AI only routes and explains, and explanations with figures not in the data are discarded; works with AI off |
| Reports | Weekly report on screen, PDF and CSV, with assumptions and data gaps; optional Monday email to owners/admins |
| SaaS | Multi-tenant workspaces with RLS, roles, join codes, plan entitlements, trial, usage quotas, audit log, account/workspace deletion |
| Billing | Razorpay subscriptions: hosted payment page, signed + de-duplicated webhooks, cancel at period end, cancel-on-delete |

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · PostgreSQL 16 with Row Level Security (`pg`, SQL
migrations) · Zod · ExcelJS + PapaParse · PDFKit · unpdf (pdf.js) · Recharts · argon2 · Vitest · Playwright · Capacitor
(Android). AI: Groq or any OpenAI-compatible API, optional.

## Requirements

- Node.js 22 (20.9+ works), npm 10
- PostgreSQL 15+ (16 recommended)
- Optional: `tesseract` and `pdftoppm` for OCR of scanned invoices

## Local development

```bash
npm ci
cp .env.example .env.local          # then edit the database URLs

# create roles and databases (adjust passwords)
psql -U postgres -c "CREATE ROLE stockpilot LOGIN CREATEDB PASSWORD 'stockpilot';"
psql -U postgres -c "CREATE ROLE stockpilot_app LOGIN NOBYPASSRLS PASSWORD 'stockpilot_app';"
psql -U postgres -c "CREATE DATABASE stockpilot_dev OWNER stockpilot;"

npm run db:migrate                   # apply migrations
npm run db:seed                      # demo login with a synthetic workspace (prints the credentials)
npm run dev                          # http://localhost:3000
```

The app connects as `stockpilot_app` (`DATABASE_URL`) for all tenant data; `DATABASE_ADMIN_URL` (schema owner) is used for
migrations, sign-in/sessions and creating workspaces. **The app role must not be a superuser or have BYPASSRLS.**

Password-reset emails are printed to the server console in development when no email provider is configured.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm run db:migrate` | Apply pending migrations (`node db/migrate.mjs`) |
| `npm run db:seed` | Create `demo@stockpilot.local` with a synthetic demo workspace (refuses to run in production) |
| `npm test` | Unit + integration tests (needs the `stockpilot_test` database: `createdb -O stockpilot stockpilot_test`) |
| `npm run test:e2e` | Playwright end-to-end tests against a production build (`npm run build` first); starts a local Razorpay stand-in on port 3199. Set `PLAYWRIGHT_CHROMIUM_PATH` if you use a system Chromium |

Integration tests **drop and recreate** the schema of `stockpilot_test` only (they refuse any other database name).

## Test results (last run: 30 Oct 2026)

- Vitest: **167 passing, 3 skipped** across 17 files (unit: engines, parsing, invoices, AI guards, S3 signing checked
  against AWS's SDK; integration against real Postgres: tenant isolation, imports, purchasing, invoices, assistant,
  reports, entitlements, deletion, billing, scheduled reports). The 3 skipped tests run against a live S3-compatible
  bucket when `S3_TEST_*` is set — they passed against a local S3 server with signature checking.
- Playwright: **12 passing** — 11 desktop (auth and anonymous-access checks, register → business → imports with a
  mapping fix → dashboard → purchase list → draft PO → PDF → receive goods → invoice review → report → assistant;
  subscribe → pay on a simulated Razorpay page → plan activated by signed webhook → cancel) and 1 mobile (Pixel 7).
  The same suite also passed against the standalone production bundle that the Docker image runs.
- `npm audit`: 0 known vulnerabilities. Lint and TypeScript clean.

## Configuration

All settings are environment variables — see [`.env.example`](.env.example). Plans, limits and indicative prices
(₹2,499 Starter, ₹4,999 Growth, custom Business) are rows in the `plans` table, enforced server-side.

## Documentation

- [Product requirements](docs/PRD.md) · [Architecture & decisions](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md)
- [Deployment & hosting comparison](docs/DEPLOYMENT.md) · [Security & privacy](docs/SECURITY.md) · [Risks](docs/RISKS.md)
- [Android](docs/ANDROID.md) · [Launch checklist](docs/LAUNCH_CHECKLIST.md) · [Implementation status](docs/IMPLEMENTATION_STATUS.md)

## Project layout

```
db/migrations/        versioned SQL (schema, RLS, plans)        db/migrate.mjs   migration runner
src/lib/domain/       pure, unit-tested logic: demand, reorder, slow-moving, units, money, imports, invoices
src/lib/services/     DB-backed services: imports, catalogue, analysis, purchasing, invoices, reports, assistant
src/lib/ai/           provider abstraction (Groq / OpenAI-compatible)
src/lib/auth|db|tenant  sessions, passwords, rate limits, pools + RLS context, membership checks
src/app/(marketing)   public site            src/app/(auth)  sign-in, sign-up, onboarding
src/app/app/          the product            src/app/api/    uploads, exports, PDFs, health
tests/unit|integration|e2e                   assets/fonts    PDF fonts (Noto Sans, OFL)
android/              Capacitor Android project               capacitor.config.ts
```
