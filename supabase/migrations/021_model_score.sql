ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS model_score DECIMAL(5,2);
