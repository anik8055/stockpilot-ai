# Launch checklist

Work through this in order. Nothing is live until step 3 is done and `/api/health` returns ok on your domain.

## 1. Before deploying
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass locally
- [ ] Playwright suite passes (`npm run test:e2e`)
- [ ] Decide hosting (see DEPLOYMENT.md — free tiers are not for commercial use)
- [ ] Read and adapt `/terms` and `/privacy` with a lawyer; add your legal entity name, address, GSTIN and grievance contact

## 2. Infrastructure
- [ ] Postgres created; `stockpilot_app` role with `NOBYPASSRLS`; migrations applied with the owner URL
- [ ] Private bucket + keys; `STORAGE_DRIVER=s3`; upload and re-open an invoice to confirm the driver works
- [ ] All env vars set in the host (never in git); `APP_URL` is https
- [ ] Email provider set; send yourself a password reset
- [ ] Optional AI: `AI_PROVIDER=groq`, key, model; check `/api/health?deep=1` with `HEALTH_CHECK_TOKEN`
- [ ] Daily database backups enabled and one restore tested

## 3. Deploy and verify
- [ ] Deployment URL loads; `/api/health` = ok
- [ ] Sign up a fresh account, create a workspace, import the templates, see dashboard numbers
- [ ] Draft a PO, download the PDF, receive goods, check stock changes once
- [ ] Upload a text PDF invoice, review, create a draft receipt
- [ ] Generate a report, download PDF/CSV
- [ ] Second account cannot see the first account's data (try a product URL from the other workspace → 404)
- [ ] Rate limits active (several wrong passwords → "Too many attempts")
- [ ] Security headers present (`curl -I https://your-domain`)

## 4. Business
- [ ] Prices final (they are indicative in the `plans` table); GST treatment decided
- [ ] Payments: Razorpay integration built and tested in test mode — or a manual invoicing process documented
- [ ] Support email monitored; demo-request inbox (table `demo_requests`) checked daily
- [ ] Error monitoring (e.g. Sentry) and uptime check on `/api/health`

## 5. Android (optional, after the web app is live)
- [ ] Follow docs/ANDROID.md: build, sign, device checklist, internal testing track
