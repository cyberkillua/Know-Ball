-- CAM (Central Attacking Midfielder) Rating Schema Migration
-- Adds CAM-specific dimension columns to match_ratings and peer_ratings.
-- Shared columns (chance_creation, team_function, carrying) already exist.

-- match_ratings: CAM-only dimension column
ALTER TABLE match_ratings
  ADD COLUMN IF NOT EXISTS goal_threat_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS goal_threat_norm DECIMAL(4,2);

-- peer_ratings: CAM dimension percentile columns
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS goal_threat_percentile INTEGER;

-- peer_ratings: CAM dimension stddev/p90 columns for season score
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS goal_threat_stddev DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS goal_threat_p90    DECIMAL(6,4);
