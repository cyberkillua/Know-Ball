-- Passing stats percentiles for peer_ratings.
-- Covers: passes completed (per90 + raw), passing accuracy,
--         accurate long balls (per90 + raw), long ball accuracy,
--         xG Chain (per90 + raw) and xG Buildup (per90 + raw) from Understat.

ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS passes_completed_per90_percentile   INTEGER,
  ADD COLUMN IF NOT EXISTS passes_completed_raw_percentile     INTEGER,
  ADD COLUMN IF NOT EXISTS passing_accuracy_percentile         INTEGER,
  ADD COLUMN IF NOT EXISTS accurate_long_balls_per90_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS accurate_long_balls_raw_percentile  INTEGER,
  ADD COLUMN IF NOT EXISTS long_ball_accuracy_percentile       INTEGER,
  ADD COLUMN IF NOT EXISTS xg_chain_per90_percentile           INTEGER,
  ADD COLUMN IF NOT EXISTS xg_chain_raw_percentile             INTEGER,
  ADD COLUMN IF NOT EXISTS xg_buildup_per90_percentile         INTEGER,
  ADD COLUMN IF NOT EXISTS xg_buildup_raw_percentile           INTEGER;
