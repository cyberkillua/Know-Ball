-- Add CM Control / Ball Security dimension.
-- Match-level only: pass security, availability, and low possession loss.

ALTER TABLE match_ratings
  ADD COLUMN IF NOT EXISTS control_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS control_norm DECIMAL(4,2);

ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS control_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS control_stddev     DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS control_p90        DECIMAL(6,4);
