-- ST Rating v7 Schema Migration
-- Adds new dimension columns (additive only — no existing columns dropped)
-- Adds cross_league_ratings table

-- match_ratings: new v7 dimension columns
ALTER TABLE match_ratings
  ADD COLUMN IF NOT EXISTS shot_generation_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS shot_generation_norm DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS chance_creation_raw  DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS chance_creation_norm DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS team_function_raw    DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS team_function_norm   DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS duels_raw            DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS duels_norm           DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS defensive_raw        DECIMAL(6,4),
  ADD COLUMN IF NOT EXISTS defensive_norm       DECIMAL(4,2);

-- peer_ratings: new v7 dimension percentile columns
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS shot_generation_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS chance_creation_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS team_function_percentile   INTEGER,
  ADD COLUMN IF NOT EXISTS duels_percentile           INTEGER,
  ADD COLUMN IF NOT EXISTS defensive_percentile       INTEGER;

-- cross_league_ratings: new table for cross-league comparison layer
CREATE TABLE IF NOT EXISTS cross_league_ratings (
  id                SERIAL PRIMARY KEY,
  player_id         INTEGER REFERENCES players(id),
  season            TEXT NOT NULL,
  position          TEXT NOT NULL,
  league_id         INTEGER REFERENCES leagues(id),
  finishing_z       DECIMAL(5,3),
  shot_generation_z DECIMAL(5,3),
  chance_creation_z DECIMAL(5,3),
  team_function_z   DECIMAL(5,3),
  carrying_z        DECIMAL(5,3),
  duels_z           DECIMAL(5,3),
  defensive_z       DECIMAL(5,3),
  composite_score   DECIMAL(5,2),
  cross_league_rank INTEGER,
  computed_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, season)
);
