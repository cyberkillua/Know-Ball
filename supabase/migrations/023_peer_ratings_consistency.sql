-- Add per-dimension stddev/p90 and consistency score to peer_ratings.
-- _stddev = standard deviation of per-match raw scores across the season (volatility)
-- _p90    = 90th-percentile per-match raw score across the season (ceiling)
-- consistency_score = 0–10, higher = more consistent within the league-season peer group

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS finishing_stddev        numeric,
  ADD COLUMN IF NOT EXISTS finishing_p90           numeric,
  ADD COLUMN IF NOT EXISTS shot_generation_stddev  numeric,
  ADD COLUMN IF NOT EXISTS shot_generation_p90     numeric,
  ADD COLUMN IF NOT EXISTS chance_creation_stddev  numeric,
  ADD COLUMN IF NOT EXISTS chance_creation_p90     numeric,
  ADD COLUMN IF NOT EXISTS carrying_stddev         numeric,
  ADD COLUMN IF NOT EXISTS carrying_p90            numeric,
  ADD COLUMN IF NOT EXISTS duels_stddev            numeric,
  ADD COLUMN IF NOT EXISTS duels_p90               numeric,
  ADD COLUMN IF NOT EXISTS defensive_stddev        numeric,
  ADD COLUMN IF NOT EXISTS defensive_p90           numeric,
  ADD COLUMN IF NOT EXISTS model_score_stddev      numeric,
  ADD COLUMN IF NOT EXISTS model_score_p90         numeric,
  ADD COLUMN IF NOT EXISTS consistency_score       numeric;
