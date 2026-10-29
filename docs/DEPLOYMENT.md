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
3. **Migrate** from your machine using the *direct* connection string:
   ```bash
   DATABASE_ADMIN_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require" npm run db:migrate
   ```
4. **Storage** — create a *private* bucket (e.g. `stockpilot-private`) and S3 access keys (Storage → S3 connection). Set `STORAGE_DRIVER=s3` and the `S3_*` variables. Do not make the bucket public.
5. **Vercel** — import the GitHub repository. Set environment variables (Production and Preview):
   - `DATABASE_URL` = pooler (transaction mode) URL with user `stockpilot_app.<ref>` and `?sslmode=require`
   - `DATABASE_ADMIN_URL` = pooler URL with the `postgres` user (used for sign-in and sessions)
   - `DATABASE_POOL_MAX=3`, `APP_URL=https://<your domain>`, storage, AI and email variables from `.env.example`
6. **Deploy**, then open `https://<domain>/api/health` — it should return `{"status":"ok"}`.
7. **Custom domain** — add it in Vercel → Domains and point DNS as instructed; update `APP_URL`.

## B. Docker (single server)

```bash
docker build -t stockpilot .
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
| Razorpay (payments) | Not integrated — plans are switched manually (see below) |

## Changing a workspace's plan (until payments are integrated)

```sql
UPDATE businesses SET plan_code = 'growth', plan_status = 'active', trial_ends_at = NULL WHERE id = '<business id>';
```
Plan limits and indicative prices live in the `plans` table (see `db/migrations/0002_plans.sql`); change them with a new
migration so every environment stays in sync.

## Payments (next step, not implemented)

When Razorpay credentials are available: create orders/subscriptions server-side, verify the payment signature and
webhook signature (HMAC-SHA256 with the webhook secret), process webhooks idempotently by event ID, and only then
update `businesses.plan_code/plan_status`. Do not mark payments as working until tested in Razorpay's test mode.

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
