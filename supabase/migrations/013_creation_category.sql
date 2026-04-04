-- Add creation category columns to match_ratings
ALTER TABLE match_ratings
  ADD COLUMN IF NOT EXISTS creation_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS creation_norm DECIMAL(4,2);
