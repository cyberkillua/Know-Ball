-- Know Ball: Add Sofascore ID columns for migration from FotMob to Sofascore
-- Version: 2.0

-- Add sofascore_id to teams
ALTER TABLE teams ADD COLUMN IF NOT EXISTS sofascore_id INTEGER;

-- Add sofascore_id to players (alongside existing fotmob_id)
ALTER TABLE players ADD COLUMN IF NOT EXISTS sofascore_id INTEGER UNIQUE;

-- Add sofascore_id to matches (alongside existing fotmob_id)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS sofascore_id INTEGER UNIQUE;

-- Add sofascore_rating to match_player_stats (replacing fotmob_rating)
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS sofascore_rating DECIMAL(3,1);

-- Add sofascore_id to leagues
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS sofascore_id INTEGER;

-- Update league sofascore IDs
UPDATE leagues SET sofascore_id = 17 WHERE fotmob_id = 47;  -- Premier League
UPDATE leagues SET sofascore_id = 18 WHERE fotmob_id = 48;  -- Championship
UPDATE leagues SET sofascore_id = 8  WHERE fotmob_id = 87;  -- La Liga
UPDATE leagues SET sofascore_id = 34 WHERE fotmob_id = 53;  -- Ligue 1
UPDATE leagues SET sofascore_id = 23 WHERE fotmob_id = 55;  -- Serie A
UPDATE leagues SET sofascore_id = 35 WHERE fotmob_id = 54;  -- Bundesliga
