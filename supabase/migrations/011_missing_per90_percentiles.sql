-- Add missing per-90 percentile columns to peer_ratings table

ALTER TABLE peer_ratings
ADD COLUMN IF NOT EXISTS aerials_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS ball_recoveries_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS dribbles_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS fouls_won_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS ground_duels_won_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS interceptions_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS tackles_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS total_contest_per90_percentile NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS touches_per90_percentile NUMERIC(5,2);