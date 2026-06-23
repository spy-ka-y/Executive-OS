-- ExecutiveOS — Amazon Aurora PostgreSQL schema (single source of truth).
-- Apply once against your Aurora cluster:
--   psql "$DATABASE_URL" -f db/schema.sql
-- Idempotent: safe to re-run. No Supabase-specific RLS/policies — access is
-- mediated by the Vercel server functions in src/lib/db/data.functions.ts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ── Authentication (users + sessions) ───────────────────────────────────────
-- Self-hosted auth on Aurora: scrypt-hashed passwords, DB-backed session tokens
-- carried in an httpOnly cookie. No third-party auth provider.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── Datasets + rows ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  source_filename TEXT,
  source_url      TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0,
  column_count    INTEGER NOT NULL DEFAULT 0,
  schema          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id         BIGSERIAL PRIMARY KEY,
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_index  INTEGER NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ── Analytics artifacts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_summaries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  metrics    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forecast_results (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  horizon    INTEGER NOT NULL DEFAULT 6,
  series     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ceo_briefs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id          UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  summary             TEXT NOT NULL DEFAULT '',
  risks               JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunities       JSONB NOT NULL DEFAULT '[]'::jsonb,
  priorities          JSONB NOT NULL DEFAULT '[]'::jsonb,
  forecast_highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  health_score        INTEGER NOT NULL DEFAULT 0,
  meta                JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultant_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id        UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  problems          JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations   JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_score      INTEGER NOT NULL DEFAULT 0,
  roi_score         INTEGER NOT NULL DEFAULT 0,
  risk_score        INTEGER NOT NULL DEFAULT 0,
  investment_thesis JSONB,
  meta              JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_simulations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id    UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Scenario',
  scenario      JSONB NOT NULL DEFAULT '{}'::jsonb,
  revenue_impact DOUBLE PRECISION NOT NULL DEFAULT 0,
  profit_impact  DOUBLE PRECISION NOT NULL DEFAULT 0,
  risk          INTEGER NOT NULL DEFAULT 0,
  confidence    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boardroom_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL DEFAULT '',
  messages   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id   UUID REFERENCES datasets(id) ON DELETE CASCADE,
  horizon_days INTEGER NOT NULL DEFAULT 30,
  initiatives  JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generated_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id   UUID REFERENCES datasets(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  storage_path TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Executive Memory (decisions + outcome loop) ─────────────────────────────
CREATE TABLE IF NOT EXISTS executive_decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id       UUID REFERENCES datasets(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES boardroom_conversations(id) ON DELETE SET NULL,
  question         TEXT NOT NULL,
  decision         TEXT NOT NULL,
  consensus_score  INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  revenue_impact   TEXT,
  profit_impact    TEXT,
  risk_level       TEXT NOT NULL DEFAULT 'Medium',
  owner            TEXT,
  timeline         TEXT,
  next_actions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'Not Started',
  progress         INTEGER NOT NULL DEFAULT 0,
  due_date         TIMESTAMPTZ,
  outcome          TEXT,            -- 'win' | 'loss' | 'mixed'
  actual_value     DOUBLE PRECISION,
  outcome_notes    TEXT,
  outcome_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Model-quality / evaluation tables (Accuracy dashboard) ──────────────────
CREATE TABLE IF NOT EXISTS model_eval_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name  TEXT NOT NULL,
  run_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  accuracy    DOUBLE PRECISION NOT NULL DEFAULT 0,
  metric_type TEXT NOT NULL DEFAULT 'accuracy',
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_model TEXT,
  judge_model TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  passed      INTEGER NOT NULL DEFAULT 0,
  pass_rate   DOUBLE PRECISION NOT NULL DEFAULT 0,
  report_path TEXT,
  failures    JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS executive_metrics_real (
  ticker           TEXT NOT NULL,
  fiscal_year      INTEGER NOT NULL,
  revenue          DOUBLE PRECISION,
  profit_margin    DOUBLE PRECISION,
  risk_level_rule  TEXT,
  risk_level_model TEXT,
  PRIMARY KEY (ticker, fiscal_year)
);

-- ── Multi-tenant ownership: user_id on every directly-listable table ─────────
-- Dataset-derived tables (kpi/forecast/brief/consultant/sim) inherit isolation
-- through their owning dataset (UUID-keyed); the tables below can be listed
-- without a dataset filter, so they are scoped by user_id directly.
ALTER TABLE datasets                ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE boardroom_conversations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE action_plans            ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE generated_reports       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE executive_decisions     ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dataset_rows_dataset ON dataset_rows(dataset_id, row_index);
CREATE INDEX IF NOT EXISTS idx_datasets_user        ON datasets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_dataset            ON kpi_summaries(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_dataset       ON forecast_results(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ceo_dataset            ON ceo_briefs(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultant_dataset     ON consultant_reports(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_dataset            ON decision_simulations(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_dataset          ON boardroom_conversations(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_dataset      ON executive_decisions(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_eval_model       ON model_eval_runs(model_name, run_date);
