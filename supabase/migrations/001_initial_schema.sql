-- Know Ball: Initial Schema
-- Version: 1.0

-- Leagues
CREATE TABLE leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  fotmob_id INTEGER,
  understat_slug TEXT,
  tier INTEGER DEFAULT 1
);

-- Teams
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  league_id INTEGER REFERENCES leagues(id),
  fotmob_id INTEGER,
  understat_id INTEGER,
  logo_url TEXT
);

-- Players
CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  fotmob_id INTEGER UNIQUE,
  understat_id INTEGER,
  position TEXT,
  nationality TEXT,
  date_of_birth DATE,
  current_team_id INTEGER REFERENCES teams(id),
  photo_url TEXT
);

-- Matches
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  league_id INTEGER REFERENCES leagues(id),
  season TEXT NOT NULL,
  matchday INTEGER,
  date DATE NOT NULL,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  fotmob_id INTEGER UNIQUE
);

-- Per-player per-match raw stats from FotMob
CREATE TABLE match_player_stats (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  player_id INTEGER REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  minutes_played INTEGER,
  position_played TEXT,

  -- Finishing
  goals INTEGER DEFAULT 0,
  shots_total INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  shots_off_target INTEGER DEFAULT 0,
  xg DECIMAL(5,3) DEFAULT 0,
  xgot DECIMAL(5,3) DEFAULT 0,

  -- Involvement
  assists INTEGER DEFAULT 0,
  xa DECIMAL(5,3) DEFAULT 0,
  key_passes INTEGER DEFAULT 0,
  touches INTEGER DEFAULT 0,
  passes_total INTEGER DEFAULT 0,
  passes_completed INTEGER DEFAULT 0,

  -- Carrying
  successful_dribbles INTEGER DEFAULT 0,
  failed_dribbles INTEGER DEFAULT 0,
  fouls_won INTEGER DEFAULT 0,

  -- Physical & Duels
  aerial_duels_won INTEGER DEFAULT 0,
  aerial_duels_lost INTEGER DEFAULT 0,
  ground_duels_won INTEGER DEFAULT 0,
  ground_duels_lost INTEGER DEFAULT 0,

  -- Pressing
  tackles_won INTEGER DEFAULT 0,
  interceptions INTEGER DEFAULT 0,

  -- Meta
  offsides INTEGER DEFAULT 0,
  fouls_committed INTEGER DEFAULT 0,
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  fotmob_rating DECIMAL(3,1),

  UNIQUE(match_id, player_id)
);

-- Per-shot data from Understat (Big 5 leagues only)
CREATE TABLE shots (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  player_id INTEGER REFERENCES players(id),
  minute INTEGER,
  x DECIMAL(6,4),
  y DECIMAL(6,4),
  xg DECIMAL(6,5),
  result TEXT,
  shot_type TEXT,
  situation TEXT,
  last_action TEXT,
  player_assisted TEXT,
  understat_id INTEGER UNIQUE
);

-- Calculated match ratings
CREATE TABLE match_ratings (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id),
  player_id INTEGER REFERENCES players(id),
  position TEXT NOT NULL,

  -- Raw category scores
  finishing_raw DECIMAL(6,4),
  involvement_raw DECIMAL(6,4),
  carrying_raw DECIMAL(6,4),
  physical_raw DECIMAL(6,4),
  pressing_raw DECIMAL(6,4),

  -- Normalized category scores
  finishing_norm DECIMAL(4,2),
  involvement_norm DECIMAL(4,2),
  carrying_norm DECIMAL(4,2),
  physical_norm DECIMAL(4,2),
  pressing_norm DECIMAL(4,2),

  -- Final
  final_rating DECIMAL(3,1),

  -- Comparison
  sofascore_rating DECIMAL(3,1),
  fotmob_rating DECIMAL(3,1),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, player_id)
);

-- Season-level peer ratings
CREATE TABLE peer_ratings (
  id SERIAL PRIMARY KEY,
  player_id INTEGER REFERENCES players(id),
  league_id INTEGER REFERENCES leagues(id),
  season TEXT NOT NULL,
  position TEXT NOT NULL,

  -- Per-90 aggregated raw stats
  goals_per90 DECIMAL(4,2),
  xa_per90 DECIMAL(4,2),
  xg_per90 DECIMAL(4,2),
  dribbles_per90 DECIMAL(4,2),
  aerial_wins_per90 DECIMAL(4,2),
  tackles_per90 DECIMAL(4,2),

  -- Percentile ranks (0-100) vs same position in same league
  finishing_percentile INTEGER,
  involvement_percentile INTEGER,
  carrying_percentile INTEGER,
  physical_percentile INTEGER,
  pressing_percentile INTEGER,
  overall_percentile INTEGER,

  -- Metadata
  matches_played INTEGER,
  minutes_played INTEGER,
  avg_match_rating DECIMAL(3,1),

  UNIQUE(player_id, league_id, season)
);

-- Rating config (weights, constants per position)
CREATE TABLE rating_config (
  id SERIAL PRIMARY KEY,
  position TEXT NOT NULL UNIQUE,
  config JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed leagues
INSERT INTO leagues (name, country, fotmob_id, understat_slug, tier) VALUES
  ('Premier League', 'England', 47, 'EPL', 1),
  ('Championship', 'England', 48, NULL, 2),
  ('La Liga', 'Spain', 87, 'La_liga', 1),
  ('Ligue 1', 'France', 53, 'Ligue_1', 1),
  ('Serie A', 'Italy', 55, 'Serie_A', 1),
  ('Bundesliga', 'Germany', 54, 'Bundesliga', 1);

-- Indexes
CREATE INDEX idx_mps_match ON match_player_stats(match_id);
CREATE INDEX idx_mps_player ON match_player_stats(player_id);
CREATE INDEX idx_mps_position ON match_player_stats(position_played);
CREATE INDEX idx_shots_match ON shots(match_id);
CREATE INDEX idx_shots_player ON shots(player_id);
CREATE INDEX idx_ratings_player ON match_ratings(player_id);
CREATE INDEX idx_ratings_match ON match_ratings(match_id);
CREATE INDEX idx_matches_league_season ON matches(league_id, season);
CREATE INDEX idx_matches_date ON matches(date);
CREATE INDEX idx_peer_player_season ON peer_ratings(player_id, season);
