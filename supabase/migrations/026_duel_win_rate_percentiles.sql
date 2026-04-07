-- Add aerial and ground duel win rate percentile columns to peer_ratings

ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS aerial_win_rate_percentile NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ground_duel_win_rate_percentile NUMERIC(5,2);
