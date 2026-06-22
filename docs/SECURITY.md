# Security posture — READ BEFORE PUTTING REAL DATA IN

This document states the current security reality honestly so no one mistakes the
demo posture for a production one.

## Current state: OPEN (no authentication)

ExecutiveOS currently runs as an **open application with no login**. Concretely:

- There is **no sign-in / sign-up flow**. The app talks to Supabase with the
  public anon key and no user session. (`supabase.auth` is wired only for
  product-analytics identification, not access control.)
- Row-Level Security on the core tables (`datasets`, `dataset_rows`,
  `ceo_briefs`, `consultant_reports`, `decision_simulations`, `action_plans`,
  `boardroom_conversations`, `generated_reports`, `executive_decisions`, …) is
  effectively **public**: a migration named *"Restore public access for hackathon
  demo"* (`20260610182715`) re-applied `FOR ALL USING (true)` policies and
  granted `anon`, overriding the owner-scoped policies that an earlier migration
  (`20260610181616`) had created.

**Implication:** anyone with the anon key (it ships in the client bundle) can
read and write **all** data across **all** "workspaces". The "Private Workspace"
label in the header is cosmetic. **Do not upload confidential company financials
to a deployed instance in this state.**

This is an accepted, deliberate posture for a demo. It is recorded here rather
than hidden.

## What it takes to close it (not yet done, by choice)

The owner-scoped RLS policies already exist in migration `20260610181616`. They
are **not** safe to re-enable on their own, because with no authenticated user
`auth.uid()` is `NULL` and every query would return nothing — the app would
appear empty/broken. Closing the hole therefore requires, in order:

1. **Authentication** — a real login/signup flow (Supabase email+password or
   magic-link), session persistence, and a route guard so unauthenticated users
   can't reach the app.
2. **Attach the session** to the Supabase client used for data calls (so
   requests carry the user's JWT and `auth.uid()` resolves).
3. **Re-harden RLS** — a migration that drops the public `USING (true)` policies,
   revokes `anon`, and re-enables the owner-scoped policies (`auth.uid() =
   user_id`) on every table, including `executive_decisions`.
4. **Backfill `user_id`** on existing rows (or treat them as orphaned/demo data).

Until step 1 ships, step 3 must not be applied to a live instance.

## Other operational gaps (out of scope for a code change)

- No audit log, no roles/permissions beyond owner, no data-residency controls.
- LLM data leaves your server to Google (Gemini). Review Google's data-use terms
  before sending confidential figures; consider an enterprise LLM agreement.
- Secrets (`GEMINI_API_KEY`, `DATABASE_URL`) are server-only and must never be
  exposed to the client — keep them out of `VITE_*` variables.
