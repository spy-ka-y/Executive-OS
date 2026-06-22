-- Connector support: remember where a dataset was imported from (a CSV /
-- Google Sheet URL) so it can be refreshed on demand. Nullable + idempotent.
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS source_url TEXT;
