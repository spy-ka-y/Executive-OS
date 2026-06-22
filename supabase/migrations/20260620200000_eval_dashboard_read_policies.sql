-- Read access for the in-app Accuracy dashboard (src/routes/accuracy.tsx).
--
-- The dashboard reads aggregate model-quality metrics with the app's anon /
-- publishable key. These rows are *metrics only* (accuracy numbers, pass rates,
-- judge verdicts) — they contain no held-out test rows and no golden answers, so
-- exposing them to the client is safe and intentional.
--
-- IMPORTANT: this does NOT touch executive_metrics_test or eval_golden_seed.
-- Those remain locked to the service role (RLS on, no policy) so the held-out
-- test set and golden reference can never leak into the product surface.

-- ── model_eval_runs (risk + forecast accuracy over time) ──────────────────
-- RLS is already enabled by 20260620190000_model_eval_runs.sql. Add a public
-- read policy so the dashboard can chart accuracy across runs.
drop policy if exists "model_eval_runs public read" on public.model_eval_runs;
create policy "model_eval_runs public read"
  on public.model_eval_runs
  for select
  to anon, authenticated
  using (true);

-- ── eval_runs (LLM-as-judge pass rate + failing scenarios) ────────────────
-- 20260620193000_eval_runs.sql created this without RLS. Enable RLS and grant
-- read-only access so the table is not implicitly writable from the client.
alter table public.eval_runs enable row level security;

drop policy if exists "eval_runs public read" on public.eval_runs;
create policy "eval_runs public read"
  on public.eval_runs
  for select
  to anon, authenticated
  using (true);
