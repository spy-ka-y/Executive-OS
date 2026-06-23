# Security posture

## Authentication & data isolation: ENABLED

ExecutiveOS now requires authentication, with per-account data isolation, all on
Amazon Aurora PostgreSQL (no third-party auth provider):

- **Sign up / sign in / sign out** with email + password. Passwords are hashed
  with Node's `scrypt` (unique salt per user, constant-time comparison) —
  `src/lib/db/password.ts`, unit-tested in `password.test.ts`.
- **Sessions** are random 256-bit tokens stored in the Aurora `sessions` table,
  carried in an **httpOnly, SameSite=Lax, Secure (in prod)** cookie. The token
  never appears in JavaScript-readable storage.
- **Route guard:** the app shell renders only for an authenticated user; everyone
  else gets the login screen (`AuthGate` in `src/routes/__root.tsx`).
- **Per-account isolation:** every data server function resolves the current user
  from the session cookie and scopes queries by `user_id`. Datasets are stamped
  with their owner; the directly-listable tables (`datasets`,
  `boardroom_conversations`, `action_plans`, `generated_reports`,
  `executive_decisions`) filter by `user_id`. Dataset-derived tables
  (`kpi_summaries`, `forecast_results`, `ceo_briefs`, `consultant_reports`,
  `decision_simulations`) inherit isolation through their owning dataset, which is
  keyed by an unguessable UUID and ownership-checked at the entry points
  (`getDataset` / `getDatasetRows` / `deleteDataset`).
- **Secrets stay server-side:** `DATABASE_URL`, password hashes and session
  tokens never reach the browser bundle (verified in the build).

## Notes / hardening backlog (not blocking)
- Writes to dataset-derived tables (`saveCeoBrief`, etc.) are isolated in
  practice via unguessable dataset UUIDs but do not yet re-verify dataset
  ownership on every write — add an ownership check there for defense-in-depth.
- No rate-limiting on auth endpoints yet; add one (and email verification /
  password reset) for production.
- LLM data leaves your server to Google (Gemini). Review Google's data-use terms
  before sending confidential figures; consider an enterprise LLM agreement.
- Legacy `supabase/migrations/` is unused (the app is on Aurora); Supabase is an
  optional, no-op auth shim that can be removed entirely.
