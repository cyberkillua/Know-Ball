-- Winger (W) Rating Schema Migration
-- Adds winger-specific dimension columns to match_ratings and peer_ratings.
-- Shared columns (chance_creation, carrying, shot_generation, defensive) already exist.

-- match_ratings: winger-only dimension columns
ALTER TABLE match_ratings
  ADD COLUMN IF NOT EXISTS productive_dribbling_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS productive_dribbling_norm DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS goal_contribution_raw     DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS goal_contribution_norm    DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS presence_raw              DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS presence_norm             DECIMAL(4,2);

-- peer_ratings: winger-only dimension percentile columns
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS productive_dribbling_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS goal_contribution_percentile    INTEGER,
  ADD COLUMN IF NOT EXISTS presence_percentile             INTEGER;

-- peer_ratings: winger dimension stddev/p90 columns for season score
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS productive_dribbling_stddev DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS productive_dribbling_p90    DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS goal_contribution_stddev    DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS goal_contribution_p90       DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS presence_stddev             DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS presence_p90                DECIMAL(6,4);
