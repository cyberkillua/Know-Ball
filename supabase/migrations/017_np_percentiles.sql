-- Add non-penalty stat columns and percentiles to peer_ratings
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS np_goals_per90 DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS np_xg_per90 DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS np_xg_per_shot DECIMAL(5,3),
  ADD COLUMN IF NOT EXISTS np_goals_per90_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS np_xg_per90_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS np_xg_per_shot_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS np_goals_raw INTEGER,
  ADD COLUMN IF NOT EXISTS np_xg_raw NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS np_goals_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS np_xg_raw_percentile INTEGER;
