-- Know Ball: add chance creation percentile columns to peer_ratings
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS assists_per90            DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS key_passes_per90         DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS accurate_cross_per90     DECIMAL(4,2),

  ADD COLUMN IF NOT EXISTS xa_per90_percentile              INTEGER,
  ADD COLUMN IF NOT EXISTS assists_per90_percentile         INTEGER,
  ADD COLUMN IF NOT EXISTS key_passes_per90_percentile      INTEGER,
  ADD COLUMN IF NOT EXISTS accurate_cross_per90_percentile  INTEGER;