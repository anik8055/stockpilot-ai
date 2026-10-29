# Security and privacy

| Area | Implementation | Where |
|---|---|---|
| Passwords | argon2id (19 MiB, t=2); min 10 chars with letter + number; constant-ish timing for unknown emails | `src/lib/auth/password.ts` |
| Sessions | 256-bit random token in an httpOnly, SameSite=Lax cookie (`__Host-` and Secure on https); only SHA-256 hash stored; 30-day expiry; all sessions revoked on password reset | `src/lib/auth/session.ts` |
| CSRF | Server Actions check `Origin` against host (Next.js); route handlers that mutate require the session cookie with SameSite=Lax | Next.js |
| Tenant isolation | Postgres RLS with a non-bypass role + membership re-check; business ID only from the server-side session; composite FKs | `db/migrations/0001_init.sql`, `src/lib/db`, `src/lib/tenant.ts`; tests in `tests/integration/tenant-isolation.test.ts` |
| Authorisation | Role → permission matrix enforced in every action and route | `src/lib/auth/permissions.ts` |
| Plan limits | Enforced in services, not only hidden in the UI | `src/lib/services/entitlements.ts` |
| Rate limiting | Postgres fixed window: sign-in (IP + email), sign-up, password reset, uploads, imports, assistant, reports | `src/lib/auth/rate-limit.ts` |
| Uploads | Size limits; type from magic bytes; .xls/binary rejected; formulas read as cached values, never evaluated; pdf.js with eval disabled; OCR runs in a temp dir with timeouts; files stored privately per business and served with `Content-Security-Policy: sandbox` | `src/lib/services/spreadsheet.ts`, `invoice-text.ts`, `src/app/api/invoices/[id]/file` |
| CSV exports | Formula-injection guard (`=`, `+`, `-`, `@` prefixed) | `src/lib/domain/imports/values.ts` |
| Output | React escapes by default; no `dangerouslySetInnerHTML` | — |
| Headers | nosniff, frame DENY, referrer policy, HSTS, permissions policy | `next.config.ts` |
| AI | Keys server-side only; model ID from env; only aggregated tool output (≤ 20 rows) sent; model cannot run SQL or mutate; outputs Zod-validated; interpretations rejected if they contain figures or SKUs not in the data; invoice text marked untrusted in prompts | `src/lib/ai`, `src/lib/services/assistant` |
| Logging | Errors logged as JSON with name/message/code only — no bodies, tokens or invoice contents | `src/lib/errors.ts` |
| Audit | Append-only `audit_events` for imports, stock changes, POs, receipts, invoices, settings, members | various services |
| Deletion | Workspace and account deletion remove database rows and stored files | `src/lib/services/workspaces.ts`, `accounts.ts` |

## Data collected and why

See the in-app privacy page (`/privacy`). In short: account details (to sign in), business data the customer imports
(to calculate stock positions and recommendations), uploaded files (to audit imports and re-open invoices), audit and
usage records (accountability and plan limits), demo-request form details (to reply). No data is used across tenants or
sold. Customers can delete a workspace or their account from Settings → Account & data, or ask by email.

## Not claimed

StockPilot holds no compliance certification (ISO 27001, SOC 2, etc.) and the docs make no such claim. A penetration
test and a legal review of the terms and privacy page are launch-checklist items.

## Known limitations

- Password-reset emails require an email provider in production.
- No 2FA yet.
- Rate limiting is per instance of Postgres, fixed-window (simple, not burst-smoothing).
- The S3 storage driver is implemented with SigV4 but has not been tested against a live bucket in this environment.
