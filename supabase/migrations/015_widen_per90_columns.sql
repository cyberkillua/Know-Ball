-- Widen per90 and rate columns in peer_ratings from DECIMAL(4,2) to DECIMAL(6,2)
-- DECIMAL(4,2) only allows values up to 99.99, which overflows for stats like
-- touches_per90 for players with very few minutes played.
-- Must drop dependent views first, then recreate after.
DROP VIEW IF EXISTS player_league_season_profile;
DROP VIEW IF EXISTS league_season_leaderboard;

ALTER TABLE peer_ratings
  ALTER COLUMN goals_per90                TYPE DECIMAL(6,2),
  ALTER COLUMN xa_per90                   TYPE DECIMAL(6,2),
  ALTER COLUMN xg_per90                   TYPE DECIMAL(6,2),
  ALTER COLUMN dribbles_per90             TYPE DECIMAL(6,2),
  ALTER COLUMN aerial_wins_per90          TYPE DECIMAL(6,2),
  ALTER COLUMN tackles_per90              TYPE DECIMAL(6,2),
  ALTER COLUMN avg_match_rating           TYPE DECIMAL(6,2),
  ALTER COLUMN xg_plus_xa_per90           TYPE DECIMAL(6,2),
  ALTER COLUMN dribble_success_rate       TYPE DECIMAL(6,2),
  ALTER COLUMN big_chances_created_per90  TYPE DECIMAL(6,2),
  ALTER COLUMN shot_conversion_rate       TYPE DECIMAL(6,2),
  ALTER COLUMN ball_recovery_per90        TYPE DECIMAL(6,2),
  ALTER COLUMN shots_per90                TYPE DECIMAL(6,2),
  ALTER COLUMN xgot_per90                 TYPE DECIMAL(6,2),
  ALTER COLUMN big_chances_missed_per90   TYPE DECIMAL(6,2),
  ALTER COLUMN assists_per90              TYPE DECIMAL(6,2),
  ALTER COLUMN key_passes_per90           TYPE DECIMAL(6,2),
  ALTER COLUMN accurate_cross_per90       TYPE DECIMAL(6,2);

-- Recreate dependent views
CREATE OR REPLACE VIEW player_league_season_profile AS
SELECT
    pr.player_id,
    pr.league_id,
    pr.season,
    pr.position,
    p.name as player_name,
    l.name as league_name,
    (
        SELECT t.name
        FROM match_player_stats mps
        JOIN matches m ON m.id = mps.match_id
        JOIN teams t ON t.id = mps.team_id
        WHERE mps.player_id = pr.player_id
        AND m.league_id = pr.league_id
        AND m.season = pr.season
        GROUP BY t.name
        ORDER BY COUNT(*) DESC
        LIMIT 1
    ) as team_name,
    pr.matches_played,
    pr.minutes_played,
    pr.avg_match_rating,
    pr.overall_percentile,
    pr.finishing_percentile,
    pr.involvement_percentile,
    pr.carrying_percentile,
    pr.physical_percentile,
    pr.pressing_percentile,
    pr.goals_per90,
    pr.xg_per90,
    pr.xa_per90
FROM peer_ratings pr
JOIN players p ON p.id = pr.player_id
JOIN leagues l ON l.id = pr.league_id;

CREATE OR REPLACE VIEW league_season_leaderboard AS
SELECT
    pr.player_id,
    pr.league_id,
    pr.season,
    pr.position,
    p.name as player_name,
    (
        SELECT t.name
        FROM match_player_stats mps
        JOIN matches m ON m.id = mps.match_id
        JOIN teams t ON t.id = mps.team_id
        WHERE mps.player_id = pr.player_id
        AND m.league_id = pr.league_id
        AND m.season = pr.season
        GROUP BY t.name
        ORDER BY COUNT(*) DESC
        LIMIT 1
    ) as team_name,
    l.name as league_name,
    pr.matches_played,
    pr.minutes_played,
    pr.avg_match_rating,
    pr.overall_percentile,
    pr.finishing_percentile,
    pr.goals_per90,
    pr.xg_per90,
    pr.xa_per90
FROM peer_ratings pr
JOIN players p ON p.id = pr.player_id
JOIN leagues l ON l.id = pr.league_id;
