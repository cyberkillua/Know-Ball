-- Know Ball: ST Peer Ratings v4
-- Adds advanced derived-stat columns and percentile columns to peer_ratings
-- Required by compute.py and the ST player profile redesign

ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS xg_plus_xa_per90              DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS xg_overperformance            DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS dribble_success_rate          DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS big_chances_created_per90     DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS shot_conversion_rate          DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS ball_recovery_per90           DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS xg_per_shot                   DECIMAL(4,3),

  -- Advanced percentile columns
  ADD COLUMN IF NOT EXISTS xg_plus_xa_percentile         INTEGER,
  ADD COLUMN IF NOT EXISTS xg_overperformance_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS dribble_success_percentile    INTEGER,
  ADD COLUMN IF NOT EXISTS shot_conversion_percentile    INTEGER,
  ADD COLUMN IF NOT EXISTS big_chances_created_percentile INTEGER;
