ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS model_score_quality numeric,
  ADD COLUMN IF NOT EXISTS model_score_peak numeric,
  ADD COLUMN IF NOT EXISTS model_score_availability numeric,
  ADD COLUMN IF NOT EXISTS model_score_confidence numeric,
  ADD COLUMN IF NOT EXISTS model_score_version integer;
