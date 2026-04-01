-- Know Ball: Add raw (total) percentile columns to peer_ratings
-- These percentiles compare raw totals instead of per-90 rates

ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS goals_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS assists_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS shots_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS xg_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS xa_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS key_passes_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS big_chances_created_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS big_chances_missed_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS accurate_cross_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS dribbles_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS fouls_won_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS touches_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS aerials_won_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS ground_duels_won_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS total_contests_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS tackles_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS interceptions_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS ball_recoveries_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS fouls_committed_raw_percentile INTEGER;