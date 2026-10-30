# Deployment

StockPilot is one Next.js app plus PostgreSQL and private file storage. Nothing here has been deployed by the build
process — no live URL exists until you complete these steps with your own accounts.

## Options compared (checked October 2026 — re-check before you buy)

| Option | Monthly cost (approx.) | Commercial use | Notes |
|---|---|---|---|
| **A. Vercel Pro + Supabase Pro** (recommended to start) | Vercel Pro $20 per developer seat + Supabase Pro from $25 | Yes | Zero server maintenance, GitHub deploys, preview URLs. No OCR binaries on Vercel, so scanned/photo invoices stay "unsupported" unless you add an OCR service. |
| B. Docker on a VPS or Render/Railway + managed Postgres | ~ $10–25 for a small instance + database | Yes (check provider terms) | Includes Tesseract OCR in the image. You handle restarts, backups and TLS (or use the provider's). |
| Vercel Hobby / Supabase Free | $0 | **Not for this product** | Vercel's fair-use guidelines restrict Hobby to non-commercial personal use; Supabase Free projects pause after a week of inactivity and have a 500 MB database. Fine for a private demo only. |

Sources: Vercel Hobby plan and fair-use guidelines (vercel.com/docs/plans/hobby, vercel.com/docs/limits/fair-use-guidelines);
Supabase pricing (supabase.com/pricing). Prices are in USD and exclude GST.

## A. Vercel + Supabase

1. **Supabase project** — create a Pro project in the region closest to your customers (check whether Mumbai is offered in your dashboard).
2. **Roles** — in the SQL editor, run:
   ```sql
   CREATE ROLE stockpilot_app LOGIN PASSWORD '<strong password>' NOBYPASSRLS;
   ```
   Migrations use the `postgres` (owner) connection. `stockpilot_app` gets its grants from migration `0001`.
3. **Migrate.** Production deploys on Vercel do this automatically (`npm run vercel-build` applies pending migrations
   when `VERCEL_ENV=production` and `DATABASE_ADMIN_URL` is set; preview deploys never touch the database; a failed
   migration fails the deploy). To run it yourself instead, use the owner connection string:
   ```bash
   DATABASE_ADMIN_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require" npm run db:migrate
   ```
4. **Storage** — create a *private* bucket (e.g. `stockpilot-private`) and S3 access keys (Storage → S3 connection). Set `STORAGE_DRIVER=s3` and the `S3_*` variables. Do not make the bucket public.
5. **Vercel** — import the GitHub repository. Set environment variables (Production and Preview):
   - `DATABASE_URL` = pooler (transaction mode) URL with user `stockpilot_app.<ref>` and `?sslmode=require`
   - `DATABASE_ADMIN_URL` = pooler URL with the `postgres` user (used for sign-in and sessions)
   - `DATABASE_POOL_MAX=3`, `APP_URL=https://<your domain>`, storage, AI and email variables from `.env.example`
   - `DATABASE_CA_CERT` = the contents of Supabase's CA certificate (Project settings → Database → SSL configuration →
     Download certificate; paste the whole PEM). Needed because the Postgres driver fully verifies TLS certificates.
   - If the pooler rejects a session setting, set `DATABASE_STATEMENT_TIMEOUT_MS=0`.
6. **Deploy**, then open `https://<domain>/api/health`. It returns `"status":"ok"` when everything is right; otherwise
   every failing part has a `problem` code and a `hint` (missing variables by name, wrong password, untrusted
   certificate, pooler username, migrations not applied…). It never shows secret values.
7. **Custom domain** — add it in Vercel → Domains and point DNS as instructed; update `APP_URL`.

## B. Docker (single server)

```bash
docker build -t stockpilot .   # not built in the development environment (Docker Hub was unreachable); the same standalone bundle was tested end to end
docker run -d --name stockpilot -p 3000:3000 --env-file .env.production \
  -v stockpilot-data:/app/.data stockpilot
docker exec stockpilot node db/migrate.mjs
```
Set `OCR_PROVIDER=tesseract_cli` to read scanned invoices. Put a TLS-terminating proxy (Caddy, nginx, or the platform's)
in front and set `APP_URL` to the https URL. Back up the Postgres database and the `/app/.data` volume.

## Environment variables

See `.env.example` — every variable is documented there. Secrets (database URLs, API keys, S3 keys) must only be set in
the host's environment settings, never committed.

## Health checks

- `GET /api/health` — database reachability and whether AI is configured (no secrets). 200 = ok, 503 = database down.
- `GET /api/health?deep=1` with header `x-health-token: $HEALTH_CHECK_TOKEN` — also verifies the AI key and model.

## What still needs your accounts

| Item | Status |
|---|---|
| Hosting account, domain, DNS | Not done — needs you |
| Managed Postgres + private bucket | Not done — needs you |
| Groq API key and model choice | Optional; app works without it |
| Email provider (Resend) for password-reset emails | Needed for production password resets; until then reset emails are not delivered (they are logged only in development) |
| Razorpay (payments) | Built and tested against a local stand-in for Razorpay; needs your Razorpay account and a test-mode run (see below) |
| Weekly report emails | Built; needs an email provider and `CRON_SECRET` (see below) |

## Changing a workspace's plan manually (Business plans, or without online payment)

```sql
UPDATE businesses SET plan_code = 'growth', plan_status = 'active', trial_ends_at = NULL WHERE id = '<business id>';
```
Plan limits and indicative prices live in the `plans` table (see `db/migrations/0002_plans.sql`); change them with a new
migration so every environment stays in sync.

## Online payments (Razorpay subscriptions)

How it works: the workspace owner clicks *Subscribe* in Settings → Plan & usage → StockPilot creates a Razorpay
subscription on the server and sends the owner to Razorpay's payment page → Razorpay sends signed webhooks →
StockPilot verifies the signature (HMAC-SHA256 of the raw body), skips already-processed event IDs, **re-reads the
subscription from Razorpay's API** (so late or out-of-order events can't undo a newer state) and only then changes the
plan. Cancelling stops renewals at the end of the paid period. Deleting a workspace or account first cancels any open
subscription and refuses to delete if Razorpay can't be reached. The app database role cannot change plan columns.

Setup (do it in **Test mode** first):
1. Razorpay dashboard → Subscriptions → Plans: create a monthly plan for Starter and Growth (amounts in paise).
2. Settings → API Keys: generate a key; set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. Settings → Webhooks: URL `https://<domain>/api/billing/razorpay/webhook`, a strong secret (`RAZORPAY_WEBHOOK_SECRET`), and the
   events `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`,
   `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.updated`.
4. `RAZORPAY_PLAN_IDS=starter:plan_…,growth:plan_…`, redeploy.
5. Test: subscribe with a Razorpay test card/UPI, confirm the plan turns Growth, cancel, check Settings shows the end
   date. Watch Razorpay → Webhooks for delivery failures. Then repeat with live keys.

Make sure the amounts you configure in Razorpay match the prices in the `plans` table (shown on the pricing page),
decide your GST invoicing (Razorpay can send invoices; GST registration is your responsibility), and have the terms
reviewed. Business (custom) plans are still activated manually with the SQL above.

| Status Razorpay reports | Effect on the workspace |
|---|---|
| authenticated, active | Plan switched to the paid plan, status active |
| pending (renewal failed, retrying) | Plan kept, status past_due, warning shown |
| halted, cancelled, completed, expired | Status cancelled → Starter features (data kept), unless another subscription is active |

## Weekly report emails

Owners/admins switch this on per workspace on the Reports page. Every Monday the scheduler calls
`/api/cron/weekly-reports`; for each opted-in workspace StockPilot creates last week's (Mon–Sun) report and emails owners
and admins a short summary with a link (no attachments). Calling it twice in a week does nothing the second time.

- **Vercel:** `vercel.json` schedules it for Monday 03:30 UTC (09:00 IST). Set `CRON_SECRET`; Vercel sends it automatically.
- **Docker / any server:** add a cron job: `30 3 * * 1 curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/weekly-reports`
- Needs `EMAIL_PROVIDER=resend` (and a verified sending domain) — otherwise reports are still created but no email is sent.

## Testing the S3 driver

The S3 signer is checked against AWS's own SDK (`tests/unit/storage.test.ts`). To run the live tests against any
S3-compatible bucket (e.g. a Supabase test bucket), set `S3_TEST_ENDPOINT`, `S3_TEST_BUCKET`, `S3_TEST_ACCESS_KEY_ID`,
`S3_TEST_SECRET_ACCESS_KEY` (and `S3_TEST_REGION`) and run `npx vitest run tests/integration/s3-storage.test.ts`. It
writes and deletes about 1,000 small objects under a random prefix.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `permission denied for table users` in logs | `DATABASE_URL` and `DATABASE_ADMIN_URL` are swapped; identity tables use the admin URL. |
| All tenant queries return nothing | `DATABASE_URL` user is not `stockpilot_app`, or migrations ran as a different owner — rerun grants from `0001_init.sql`. |
| "Migration … changed after being applied" | Never edit applied migrations; add a new file. |
| Sessions lost after deploy on http | Production cookies are `Secure`; use https and set `APP_URL` to the https URL. |
| PDF has missing characters | `assets/fonts` must be deployed (traced via `outputFileTracingIncludes`). |
| Scanned invoices say "OCR is not configured" | Expected on Vercel. Use the Docker image with `OCR_PROVIDER=tesseract_cli`, or add an OCR service. |
| "Too many requests" during testing | Rate limits are strict in production by design. Wait for the window or test against a non-production deployment. |
