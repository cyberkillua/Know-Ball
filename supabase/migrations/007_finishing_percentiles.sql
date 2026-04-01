-- Know Ball: add xg_per90, xgot_per90, big_chances_missed per-90 stats and percentiles
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS xgot_per90 DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS big_chances_missed_per90 DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS xg_per90_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS xgot_per90_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS big_chances_missed_percentile INTEGER;