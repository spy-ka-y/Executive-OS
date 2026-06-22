-- Read access for the in-app "Real-World Backtest" panel on the Accuracy
-- dashboard (src/routes/accuracy.tsx).
--
-- executive_metrics_real holds REAL public-company financials (already public on
-- SEC EDGAR) plus computed risk tiers — no held-out test rows, no golden
-- answers. Exposing it to the app's anon/publishable key is safe and intentional.
--
-- This is the same approach as 20260620200000_eval_dashboard_read_policies.sql,
-- and is DISTINCT from executive_metrics_test / eval_golden_seed, which stay
-- service-role only (RLS on, no policy) so held-out data cannot leak.

drop policy if exists "executive_metrics_real public read" on public.executive_metrics_real;
create policy "executive_metrics_real public read"
  on public.executive_metrics_real
  for select
  to anon, authenticated
  using (true);
