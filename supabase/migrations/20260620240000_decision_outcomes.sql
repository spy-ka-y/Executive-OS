-- Outcome loop: record how a logged executive decision ACTUALLY turned out, so
-- the product can report a real hit-rate (graded by reality) instead of an LLM's
-- self-assessment or a mere completion count. Nullable + idempotent.
ALTER TABLE public.executive_decisions ADD COLUMN IF NOT EXISTS outcome TEXT;            -- 'win' | 'loss' | 'mixed'
ALTER TABLE public.executive_decisions ADD COLUMN IF NOT EXISTS actual_value NUMERIC;    -- realized revenue/profit impact, if known
ALTER TABLE public.executive_decisions ADD COLUMN IF NOT EXISTS outcome_notes TEXT;
ALTER TABLE public.executive_decisions ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;
