# Architecture

## Overview
A single Next.js (App Router, TypeScript strict) application backed by PostgreSQL. One deployable unit, no
microservices. Business logic lives in framework-free modules under `src/lib/domain` and is unit tested
directly; React components only render and call server actions / route handlers.

```
Browser ──► Next.js (server components, server actions, route handlers)
              │  src/lib/auth      sessions, passwords, rate limits
              │  src/lib/tenant    requireTenant(): user + verified membership + role
              │  src/lib/db        pools, withTenant() transaction with RLS context
              │  src/lib/domain    pure calculations (reorder, demand, slow-moving, units, money, invoices)
              │  src/lib/services  DB-backed services (imports, ledger, purchasing, reports, assistant tools)
              │  src/lib/ai        provider abstraction (Groq / OpenAI-compatible), prompts, output schemas
              │  src/lib/storage   private object storage (local disk or S3-compatible)
              ▼
          PostgreSQL 16 (RLS on every tenant table)
```

## Key decisions (ADR summary)

| # | Decision | Why |
|---|---|---|
| 1 | Next.js 16 App Router, Cache Components **disabled** | Almost every page is per-tenant and per-request; the classic dynamic model is simpler and safer (no accidental cross-tenant caching). |
| 2 | Plain SQL migrations + `pg` driver (no ORM) | RLS, triggers and numeric semantics are explicit and reviewable; one less abstraction for a solo maintainer. |
| 3 | Built-in email/password auth (argon2id, opaque session tokens stored as SHA-256 hashes, httpOnly cookies) | Runs identically locally, in CI and on any host; avoids coupling to a hosted auth stack. Supabase Postgres is still fully supported as the database. |
| 4 | Two DB roles: migration owner and `stockpilot_app` (NOBYPASSRLS) | RLS is enforced by the database even if server code forgets a filter. Owner connection is used only for auth/session tables, workspace creation, rate limiting and seeding. |
| 5 | Tenant context = `SET LOCAL app.user_id / app.business_id` inside each transaction | The business ID comes from the server-side session row (set by a membership-checked switch), never from request bodies. Policies additionally re-check membership. |
| 6 | Immutable stock movement ledger; `products.on_hand` maintained only by a trigger on ledger inserts | One source of truth for stock changes; cached balance cannot drift because updates/deletes of movements are blocked. |
| 7 | Stock snapshot import = observation + reconciling delta movement | Reimporting the same snapshot posts a zero delta → naturally idempotent. |
| 8 | Sales history import = demand data only, never a stock movement | Billing-system closing stock already reflects those sales; reducing again would double count. |
| 9 | Deterministic engines; LLM only routes questions and writes interpretations of tool output | Numbers are reproducible and testable; the app works with AI turned off. |
| 10 | Invoice extraction pipeline: text layer → (optional) LLM structuring of *extracted text* → deterministic arithmetic checks | Avoids trusting an LLM's reading of a whole document; unsupported files are reported, never "pretend processed". |
| 11 | Rate limits and usage counters in Postgres | Works on serverless without Redis. |
| 12 | Money as `numeric(14,2)` in DB and `decimal.js` in TS | No binary float rounding in totals. |

## Request flow for a protected mutation
1. Server action / route handler calls `requireTenant({ role })`.
2. Session cookie → SHA-256 → `sessions` row (owner pool) → user, active business.
3. Membership row verified; role checked against the required permission.
4. Entitlement check (plan limits) where relevant.
5. `withTenant(ctx, tx => …)` opens a transaction as `stockpilot_app`, sets RLS context, runs the service.
6. Audit event written in the same transaction for important operations.

## Rounding rules
- Quantities: `numeric(14,3)` in the product's base unit.
- Unit costs: `numeric(14,4)`; line totals and money: `numeric(14,2)`, rounded half-up per line, then summed.
- Reorder suggestions are rounded **up** to whole base units, then up to MOQ / pack size multiples.

## AI
`AI_PROVIDER=groq|openai_compatible|none`. Provider implements `chatJSON(messages, schema)`.
Every response is validated with Zod; invalid output is discarded and the deterministic answer is shown.
Per-workspace monthly quotas are enforced server-side from plan limits; each call is logged in `ai_usage`.

## Storage
`STORAGE_DRIVER=local|s3`. Local writes under `STORAGE_DIR` (dev/self-host). S3 driver works with Supabase Storage
(S3 protocol), Cloudflare R2 or AWS S3. Object keys are prefixed by business ID and only served through an
authorized route handler — never public URLs.
