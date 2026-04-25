-- ============================================================
-- Migration 036: Passing data expansion
--
-- Adds per-match and season-level passing fields from Sofascore
-- that were already in API responses but not persisted.
--
-- Per-match player (match_player_stats):
--   own-half / opposition-half pass volumes and accuracies,
--   plus Sofascore's passValueNormalized quality metric.
--
-- Per-match team (match_team_stats):
--   final-third entries and final-third phase counts for
--   team-context normalization.
--
-- Player profile (players):
--   proposedMarketValue + contract_until already available on
--   player/{id} but not stored.
--
-- New table player_season_sofascore:
--   per-player per-league-per-season aggregate stats from
--   unique-tournament/{t}/season/{s}/statistics/overall, keyed
--   by (player_id, league_id, season).
-- ============================================================

-- ---------- Per-match player passing expansion ----------

ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS accurate_own_half_passes INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_own_half_passes INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS accurate_opposition_half_passes INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_opposition_half_passes INTEGER DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS pass_value_normalized NUMERIC(5,3);

-- ---------- Per-match team passing expansion ----------

ALTER TABLE match_team_stats ADD COLUMN IF NOT EXISTS final_third_entries INTEGER DEFAULT 0;
ALTER TABLE match_team_stats ADD COLUMN IF NOT EXISTS final_third_phase_stats INTEGER DEFAULT 0;

-- ---------- Player profile: market value + contract ----------

ALTER TABLE players ADD COLUMN IF NOT EXISTS market_value BIGINT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS market_value_currency TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS contract_until TIMESTAMP;

-- ---------- Season-level Sofascore stats ----------

CREATE TABLE IF NOT EXISTS player_season_sofascore (
  player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  league_id        INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season           TEXT    NOT NULL,

  -- Appearance / rating meta
  appearances             INTEGER,
  matches_started         INTEGER,
  minutes_played          INTEGER,
  rating                  NUMERIC(4,2),
  total_rating            NUMERIC(7,2),
  count_rating            INTEGER,
  totw_appearances        INTEGER,

  -- Goals / shots
  goals                   INTEGER,
  expected_goals          NUMERIC(6,3),
  penalty_goals           INTEGER,
  headed_goals            INTEGER,
  left_foot_goals         INTEGER,
  right_foot_goals        INTEGER,
  goals_from_inside_box   INTEGER,
  goals_from_outside_box  INTEGER,
  shots_total             INTEGER,
  shots_on_target         INTEGER,
  shots_off_target        INTEGER,
  shots_from_inside_box   INTEGER,
  shots_from_outside_box  INTEGER,
  blocked_shots           INTEGER,
  hit_woodwork            INTEGER,
  goal_conversion_pct     NUMERIC(5,2),
  scoring_frequency       NUMERIC(6,2),

  -- Passing (the main point of this migration at season level)
  accurate_passes                  INTEGER,
  total_passes                     INTEGER,
  accurate_passes_pct              NUMERIC(5,2),
  inaccurate_passes                INTEGER,
  accurate_opposition_half_passes  INTEGER,
  total_opposition_half_passes     INTEGER,
  accurate_own_half_passes         INTEGER,
  total_own_half_passes            INTEGER,
  accurate_final_third_passes      INTEGER,
  accurate_chipped_passes          INTEGER,
  total_chipped_passes             INTEGER,
  accurate_long_balls              INTEGER,
  total_long_balls                 INTEGER,
  accurate_long_balls_pct          NUMERIC(5,2),
  accurate_crosses                 INTEGER,
  total_cross                      INTEGER,
  accurate_crosses_pct             NUMERIC(5,2),
  key_passes                       INTEGER,
  pass_to_assist                   INTEGER,
  total_attempt_assist             INTEGER,

  -- Creation
  assists                  INTEGER,
  expected_assists         NUMERIC(6,3),
  goals_assists_sum        INTEGER,
  big_chances_created      INTEGER,
  big_chances_missed       INTEGER,

  -- Dribbling / carrying
  successful_dribbles          INTEGER,
  successful_dribbles_pct      NUMERIC(5,2),
  total_contest                INTEGER,
  dispossessed                 INTEGER,
  possession_lost              INTEGER,
  possession_won_att_third     INTEGER,
  dribbled_past                INTEGER,

  -- Duels / defending
  aerial_duels_won         INTEGER,
  aerial_duels_won_pct     NUMERIC(5,2),
  aerial_lost              INTEGER,
  ground_duels_won         INTEGER,
  ground_duels_won_pct     NUMERIC(5,2),
  total_duels_won          INTEGER,
  total_duels_won_pct      NUMERIC(5,2),
  duel_lost                INTEGER,
  tackles                  INTEGER,
  tackles_won              INTEGER,
  tackles_won_pct          NUMERIC(5,2),
  interceptions            INTEGER,
  clearances               INTEGER,
  outfielder_blocks        INTEGER,
  ball_recovery            INTEGER,
  error_lead_to_goal       INTEGER,
  error_lead_to_shot       INTEGER,

  -- Discipline / misc
  fouls            INTEGER,
  was_fouled       INTEGER,
  offsides         INTEGER,
  yellow_cards     INTEGER,
  yellow_red_cards INTEGER,
  red_cards        INTEGER,
  own_goals        INTEGER,
  penalty_won      INTEGER,
  penalty_conceded INTEGER,
  touches          INTEGER,

  fetched_at       TIMESTAMP DEFAULT NOW(),

  PRIMARY KEY (player_id, league_id, season)  
);

CREATE INDEX IF NOT EXISTS idx_player_season_sofascore_player
  ON player_season_sofascore (player_id);
CREATE INDEX IF NOT EXISTS idx_player_season_sofascore_league_season
  ON player_season_sofascore (league_id, season);
