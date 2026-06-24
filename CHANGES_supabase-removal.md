# Change Plan — Remove Supabase, keep 100% Amazon Aurora

**Goal:** Make the codebase match the submission narrative ("Amazon Aurora
PostgreSQL is the single source of truth; no third-party auth/data provider")
by deleting all vestigial Supabase scaffolding.

**Key fact:** Aurora is *already* the database and auth layer. Supabase does
**no** data or real-auth work today. Removing it changes no app behavior except
that the Pendo analytics tag loses a visitor id (irrelevant to the demo/judging).

**Verification after each step:** `grep -rin supabase src` (should trend to
zero) and `bun run build` (must still succeed).

---

## Summary of impact

| Area | Before | After |
|---|---|---|
| Database | Aurora (`src/lib/db`) | Aurora (unchanged) |
| Auth | Aurora httpOnly cookie (`auth.server.ts`) | Aurora httpOnly cookie (unchanged) |
| Supabase client/auth | Vestigial, wired but unused for data | Removed |
| Pendo analytics | Visitor id from Supabase session | Optional: from real `getMeFn`, or dropped |
| Build | Passes | Passes |

No schema change. No `data.functions.ts` change. No `aurora.server.ts` change.

---

## Files to DELETE (all dead once imports below are removed)

- `src/integrations/supabase/auth-attacher.ts`   — bearer-token middleware (real auth uses cookie)
- `src/integrations/supabase/auth-middleware.ts`  — `requireSupabaseAuth`, never imported
- `src/integrations/supabase/client.ts`           — supabase browser client
- `src/integrations/supabase/client.server.ts`    — `supabaseAdmin`, never imported
- `src/integrations/supabase/types.ts`            — supabase-generated DB types
- The whole `src/integrations/supabase/` folder ends up empty → remove it.

---

## Files to EDIT

### 1. `src/start.ts`
Remove the Supabase function middleware. Real serverFns authenticate via the
httpOnly session cookie, so this middleware is dead weight.

- **Remove** the import:
  `import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";`
- **Change** the start instance from:
  ```ts
  export const startInstance = createStart(() => ({
    functionMiddleware: [attachSupabaseAuth],
    requestMiddleware: [errorMiddleware],
  }));
  ```
  to:
  ```ts
  export const startInstance = createStart(() => ({
    requestMiddleware: [errorMiddleware],
  }));
  ```

### 2. `src/routes/__root.tsx`
The Supabase reference here only feeds Pendo analytics — not auth, not data.

- **Remove** the import (line ~26):
  `import { supabase } from "@/integrations/supabase/client";`
- **Remove** the `supabase.auth.onAuthStateChange(...)` block inside the
  `useEffect` (≈ lines 130–152), including its `subscription.unsubscribe()`
  cleanup.
- **Choose one:**
  - **(a) Drop Pendo identification** — leave `pendo.initialize(...)` only; simplest.
  - **(b) Keep Pendo on real auth** — call `getMeFn()` and, if a user is
    returned, `pendo.identify({ visitor: { id: user.id } })`. Use this only if
    Pendo matters to you (it does not for judging).

### 3. `package.json`
- **Remove** the dependency line: `"@supabase/supabase-js": "^2.107.0",`
- Run `bun install` to update `bun.lock`.

---

## Files to LEAVE (comments only — optional cosmetic tidy)

These contain the word "supabase" only in comments; the code is already pure
Aurora/`pg`. Safe to leave, or clean the comments for polish:

- `src/lib/api/example.functions.ts:11` — comment about Edge Functions pattern
- `src/lib/eval/persistence.ts:27`      — comment referencing an old migration file
- `src/server.ts:7`                      — comment listing env vars (drop `SUPABASE_URL`)

---

## Environment variables

- **Remove** from Vercel + local `.env` (no longer read):
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Keep / ensure set:** `DATABASE_URL` (Aurora endpoint), `GEMINI_API_KEY`

---

## Aurora integration checklist (already wired in code — env only)

1. AWS Console → RDS → create **Aurora PostgreSQL Serverless v2**.
2. Build `DATABASE_URL=postgres://USER:PASS@ENDPOINT:5432/DBNAME`.
3. `psql "$DATABASE_URL" -f db/schema.sql`
4. Set `DATABASE_URL` + `GEMINI_API_KEY` in Vercel env.
5. `bun run build` → deploy → test signup → ingest → CEO brief → boardroom.
6. Capture screenshots: RDS cluster + Vercel `DATABASE_URL` (submission requirement).

---

## Acceptance criteria

- [ ] `grep -rin supabase src` returns **nothing** (or comment-only, if tidied).
- [ ] `src/integrations/supabase/` folder no longer exists.
- [ ] `@supabase/supabase-js` absent from `package.json` + `bun.lock`.
- [ ] `bun run build` succeeds.
- [ ] App still: signs up, logs in, ingests data, renders CEO brief / boardroom
      (all against Aurora).
- [ ] No remaining `SUPABASE_*` env vars required to run.
