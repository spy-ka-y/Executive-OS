-- Eval / training seed tables for ExecutiveOS.
--
-- Leakage protection: train and test are PHYSICALLY SEPARATE tables, AND each
-- carries a `split` column locked by a CHECK constraint so a row can never be
-- written into the wrong table (e.g. a test row can never land in train).
--
-- RLS is enabled with NO public policies: only the service role (used by the
-- seed script) can read/write. This keeps the held-out test set and golden
-- eval set out of reach of the app's anon/publishable key at runtime, so they
-- cannot leak into the product surface. To let the app read TRAIN data later,
-- add an explicit SELECT policy on executive_metrics_train only.

-- ── Training metrics (6000 rows) ──────────────────────────────────────────
create table if not exists public.executive_metrics_train (
  id                          bigint generated always as identity primary key,
  split                       text not null default 'train',
  date                        date,
  region                      text,
  country                     text,
  business_unit               text,
  category                    text,
  revenue                     numeric,
  profit                      numeric,
  profit_margin               numeric,
  marketing_spend             numeric,
  headcount                   integer,
  customers                   integer,
  customer_concentration_pct  numeric,
  churn_pct                   numeric,
  forecast_accuracy           integer,
  risk_level                  text,
  initiative                  text,
  owner                       text,
  status                      text,
  created_at                  timestamptz not null default now(),
  constraint executive_metrics_train_split_chk check (split = 'train')
);

-- ── Held-out test metrics (1500 rows) — NEVER use for training ────────────
create table if not exists public.executive_metrics_test (
  id                          bigint generated always as identity primary key,
  split                       text not null default 'test',
  date                        date,
  region                      text,
  country                     text,
  business_unit               text,
  category                    text,
  revenue                     numeric,
  profit                      numeric,
  profit_margin               numeric,
  marketing_spend             numeric,
  headcount                   integer,
  customers                   integer,
  customer_concentration_pct  numeric,
  churn_pct                   numeric,
  forecast_accuracy           integer,
  risk_level                  text,
  initiative                  text,
  owner                       text,
  status                      text,
  created_at                  timestamptz not null default now(),
  constraint executive_metrics_test_split_chk check (split = 'test')
);

-- ── Golden eval scenarios (5 rows) — graded reference, not for training ───
create table if not exists public.eval_golden_seed (
  scenario_id                 text primary key,
  region                      text,
  category                    text,
  revenue                     numeric,
  profit_margin               numeric,
  customer_concentration_pct  numeric,
  churn_pct                   numeric,
  golden_risk_level           text,
  golden_initiative           text,
  golden_insight_summary      text,
  rubric_criteria             text,
  created_at                  timestamptz not null default now()
);

-- Helpful filters for grouping during analysis/scoring.
create index if not exists idx_metrics_train_region_cat on public.executive_metrics_train (region, category);
create index if not exists idx_metrics_test_region_cat  on public.executive_metrics_test  (region, category);

-- Lock down: RLS on, no public policies → service-role only.
alter table public.executive_metrics_train enable row level security;
alter table public.executive_metrics_test  enable row level security;
alter table public.eval_golden_seed         enable row level security;
