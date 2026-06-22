-- Tracks model evaluation runs over time so accuracy is observable across
-- retrains. Written by ml/log_eval_run.py from the eval scripts (risk + forecast).
create table if not exists public.model_eval_runs (
  id          bigint generated always as identity primary key,
  model_name  text not null,                 -- e.g. risk_level_rf, forecast_revenue_gbr
  run_date    timestamptz not null default now(),
  accuracy    numeric not null,              -- risk: accuracy; forecast: 1 - MAPE
  metric_type text not null,                 -- 'accuracy' | '1-MAPE'
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_model_eval_runs_model_date
  on public.model_eval_runs (model_name, run_date desc);

-- RLS on; service-role only (the eval logger uses the service-role key).
alter table public.model_eval_runs enable row level security;
