-- Know Ball: add shots_per90 and shots_per90_percentile to peer_ratings
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS shots_per90 DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS shots_per90_percentile INTEGER;