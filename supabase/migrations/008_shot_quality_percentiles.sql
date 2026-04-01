-- Know Ball: add xg_per_shot and shot_on_target percentiles
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS shot_on_target_rate DECIMAL(4,3),
  ADD COLUMN IF NOT EXISTS xg_per_shot_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS shot_on_target_percentile INTEGER;