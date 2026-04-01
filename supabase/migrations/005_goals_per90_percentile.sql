-- Know Ball: add goals_per90_percentile to peer_ratings
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS goals_per90_percentile INTEGER;
