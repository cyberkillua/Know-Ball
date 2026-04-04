-- Add non-penalty stats columns to match_player_stats
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS penalty_goals INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS np_xg NUMERIC(8,4) DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS np_shots INTEGER DEFAULT 0;
