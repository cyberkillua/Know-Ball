-- CM (Central Midfielder) Rating Schema Migration
-- Adds CM-specific dimension columns to match_ratings and peer_ratings.
-- Shared columns (chance_creation, carrying, defensive, goal_threat) already exist.

-- match_ratings: CM-only dimension column
ALTER TABLE match_ratings
  ADD COLUMN IF NOT EXISTS passing_progression_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS passing_progression_norm DECIMAL(4,2);

-- peer_ratings: CM dimension percentile column
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS passing_progression_percentile INTEGER;

-- peer_ratings: CM dimension stddev/p90 columns for season score
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS passing_progression_stddev DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS passing_progression_p90    DECIMAL(6,4);
