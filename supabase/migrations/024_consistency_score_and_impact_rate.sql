-- Redefine consistency_score as % of matches with finishing_raw > 0
-- Add impact_rate as % of matches with finishing_raw > 0.5
ALTER TABLE public.peer_ratings
  DROP COLUMN IF EXISTS consistency_score;

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS consistency_score numeric,   -- % matches with finishing_raw > 0 (0-100)
  ADD COLUMN IF NOT EXISTS impact_rate numeric;         -- % matches with finishing_raw > 0.5 (0-100)
