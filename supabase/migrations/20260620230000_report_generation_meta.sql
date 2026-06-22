-- Persist how a CEO Brief / Consultant Report was generated (live AI vs the
-- built-in deterministic engine, and the fallback reason) so the UI can show
-- honest provenance even after a page reload. Nullable + idempotent so existing
-- rows and un-migrated clients keep working.
ALTER TABLE public.ceo_briefs ADD COLUMN IF NOT EXISTS meta JSONB;
ALTER TABLE public.consultant_reports ADD COLUMN IF NOT EXISTS meta JSONB;
