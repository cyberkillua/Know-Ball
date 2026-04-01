-- Know Ball: Expanded stats collection from Sofascore
-- Version: 3.0
-- Adds: new player stat columns, GK table, team match stats, standings, odds, shot map extensions, player profile columns

-- ============================================================
-- Phase 1: Additional outfield player stats (from existing lineups endpoint)
-- ============================================================

-- Passing detail
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_cross INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS accurate_cross INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_long_balls INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS accurate_long_balls INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS big_chance_created INTEGER DEFAULT 0;

-- Shooting detail
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS big_chance_missed INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS hit_woodwork INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS blocked_scoring_attempt INTEGER DEFAULT 0;

-- Defensive
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS clearances INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS head_clearance INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS outfielder_block INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS ball_recovery INTEGER DEFAULT 0;

-- Errors
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS error_lead_to_goal INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS error_lead_to_shot INTEGER DEFAULT 0;

-- Possession
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS possession_lost_ctrl INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_contest INTEGER DEFAULT 0;

-- Other
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS penalty_won INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS penalty_conceded INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS own_goals INTEGER DEFAULT 0;

-- ============================================================
-- Phase 2: Goalkeeper stats (separate table)
-- ============================================================

CREATE TABLE IF NOT EXISTS match_gk_stats (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  player_id INTEGER REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  minutes_played INTEGER,

  -- GK-specific
  saves INTEGER DEFAULT 0,
  punches INTEGER DEFAULT 0,
  goals_prevented DECIMAL(5,3) DEFAULT 0,
  good_high_claim INTEGER DEFAULT 0,
  saves_inside_box INTEGER DEFAULT 0,
  diving_save INTEGER DEFAULT 0,
  goals_conceded INTEGER DEFAULT 0,

  -- Shared stats relevant to GK performance
  touches INTEGER DEFAULT 0,
  passes_total INTEGER DEFAULT 0,
  passes_completed INTEGER DEFAULT 0,
  total_long_balls INTEGER DEFAULT 0,
  accurate_long_balls INTEGER DEFAULT 0,
  aerial_duels_won INTEGER DEFAULT 0,
  aerial_duels_lost INTEGER DEFAULT 0,
  clearances INTEGER DEFAULT 0,
  ball_recovery INTEGER DEFAULT 0,
  error_lead_to_goal INTEGER DEFAULT 0,
  error_lead_to_shot INTEGER DEFAULT 0,
  penalty_conceded INTEGER DEFAULT 0,
  sofascore_rating DECIMAL(3,1),

  UNIQUE(match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_gk_stats_match ON match_gk_stats(match_id);
CREATE INDEX IF NOT EXISTS idx_gk_stats_player ON match_gk_stats(player_id);

-- ============================================================
-- Phase 3: Player profile columns
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS height_cm INTEGER;
ALTER TABLE players ADD COLUMN IF NOT EXISTS preferred_foot TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS shirt_number INTEGER;

-- ============================================================
-- Phase 4: Team match statistics
-- ============================================================

CREATE TABLE IF NOT EXISTS match_team_stats (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  team_id INTEGER REFERENCES teams(id),
  possession_pct DECIMAL(4,1),
  total_shots INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  corners INTEGER DEFAULT 0,
  fouls INTEGER DEFAULT 0,
  offsides_team INTEGER DEFAULT 0,
  expected_goals DECIMAL(5,3),
  big_chances INTEGER DEFAULT 0,
  big_chances_missed INTEGER DEFAULT 0,
  accurate_passes INTEGER DEFAULT 0,
  total_passes INTEGER DEFAULT 0,
  tackles INTEGER DEFAULT 0,
  interceptions INTEGER DEFAULT 0,
  saves_team INTEGER DEFAULT 0,

  UNIQUE(match_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_match_team_stats_match ON match_team_stats(match_id);

-- ============================================================
-- Phase 5: League standings
-- ============================================================

CREATE TABLE IF NOT EXISTS league_standings (
  id SERIAL PRIMARY KEY,
  league_id INTEGER REFERENCES leagues(id),
  season TEXT NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  position INTEGER,
  points INTEGER DEFAULT 0,
  played INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  drawn INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  goal_difference INTEGER DEFAULT 0,
  form TEXT,
  fetched_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(league_id, season, team_id)
);

CREATE INDEX IF NOT EXISTS idx_standings_league_season ON league_standings(league_id, season);

-- ============================================================
-- Phase 6: Betting odds
-- ============================================================

CREATE TABLE IF NOT EXISTS match_odds (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id) UNIQUE,
  home_win DECIMAL(5,2),
  draw DECIMAL(5,2),
  away_win DECIMAL(5,2)
);

-- ============================================================
-- Phase 7: Shot map extensions
-- ============================================================

ALTER TABLE shots ADD COLUMN IF NOT EXISTS sofascore_id INTEGER;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'understat';
ALTER TABLE shots ADD COLUMN IF NOT EXISTS body_part TEXT;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS goal_mouth_y DECIMAL(6,4);
ALTER TABLE shots ADD COLUMN IF NOT EXISTS goal_mouth_z DECIMAL(6,4);

-- Add unique constraint for sofascore shots (separate from understat_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shots_sofascore_id ON shots(sofascore_id) WHERE sofascore_id IS NOT NULL;
