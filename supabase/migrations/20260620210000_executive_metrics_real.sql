-- Real-company metrics table for the risk backtest (Prompt 7).
--
-- One row per (ticker, fiscal_year) for 10 real public companies. Joins:
--   - REAL operating financials from SEC EDGAR 10-Ks (Revenue, Profit=operating
--     income, Profit_Margin) — data/seed/ExecutiveOS_Real_Financials.xlsx
--   - HAND-VERIFIED customer-concentration findings from each company's latest
--     10-K — data/seed/ExecutiveOS_Real_Concentration_Findings.xlsx
-- plus the computed risk labels (built by ml/backtest_real.py and loaded by
-- data/seed/seed.ts).
--
-- Same pattern as the other seed tables (executive_metrics_train/test,
-- eval_golden_seed): RLS enabled with NO public policies, so only the service
-- role can read/write. This data is sourced from public SEC filings, so it is
-- not secret — RLS-locked purely to match the seed-table convention. Add an
-- explicit SELECT policy later if the app needs to read it at runtime.
--
-- TWO documented findings are encoded in this table — see docs/REAL_DATA_BACKTEST.md:
--   1. customer_concentration_pct never trips the absolute 60/70% rule on real
--      companies, so risk_level_rule is effectively margin-only. A relative
--      mode (risk_level_rule_relative) ranks concentration by percentile instead.
--   2. revenue/profit are ~1000x+ outside the synthetic training range, so the
--      RandomForest (risk_level_model) is out-of-distribution and merely echoes
--      the rule. Retraining is an OPEN TODO (whole-company vs segment scope).

create table if not exists public.executive_metrics_real (
  id                          bigint generated always as identity primary key,
  ticker                      text not null,
  fiscal_year                 integer not null,

  -- Real SEC EDGAR financials
  revenue                     numeric,   -- annual net revenue (USD)
  profit                      numeric,   -- OPERATING income (us-gaap:OperatingIncomeLoss)
  profit_margin               numeric,   -- operating income / revenue (%)

  -- Customer concentration (hand-verified from 10-K)
  customer_concentration_pct  numeric,   -- largest customer % of net sales; <10% rows use a 5.0 proxy
  concentration_source        text,      -- 'disclosed' | 'below-threshold proxy (<10%, not individually disclosed)'
  concentration_disclosed     text,      -- raw finding text (e.g. '17.0' or 'None disclosed (<10%)')
  largest_customer            text,      -- may be 'Undisclosed (10-K reports as Customer A/B)'
  concentration_percentile    numeric,   -- 0..1 rank of concentration among the 10 companies (relative mode)

  -- Imputed (synthetic-train medians; NOT from real filings — see imputed_features)
  marketing_spend             numeric,
  headcount                   integer,
  customers                   integer,
  churn_pct                   numeric,
  forecast_accuracy           integer,
  imputed_features            text,

  -- Computed risk labels
  risk_level_rule             text,      -- absolute 60/70% rule (original; untouched)
  risk_level_rule_relative    text,      -- percentile-band concentration + margin (real-company mode)
  risk_level_model            text,      -- shipped RandomForest (out-of-distribution; echoes rule)
  model_confidence            numeric,

  source                      text default 'SEC EDGAR 10-K financials + hand-verified 10-K concentration',
  created_at                  timestamptz not null default now(),

  unique (ticker, fiscal_year)
);

create index if not exists idx_metrics_real_ticker_year
  on public.executive_metrics_real (ticker, fiscal_year desc);

-- Lock down: RLS on, no public policies -> service-role only (matches seed tables).
alter table public.executive_metrics_real enable row level security;
