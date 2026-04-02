-- Know Ball: League + Season Scoped Views
-- Provides easy access to player ratings and teams for UI filters

-- View: Player ratings with team context for specific league+season
-- Usage: SELECT * FROM player_league_season_profile 
--        WHERE league_id = X AND season = 'Y'
CREATE OR REPLACE VIEW player_league_season_profile AS
SELECT 
    pr.player_id,
    pr.league_id,
    pr.season,
    pr.position,
    p.name as player_name,
    l.name as league_name,
    -- Primary team (most matches in this league+season)
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
    -- Minutes and matches
    pr.matches_played,
    pr.minutes_played,
    pr.avg_match_rating,
    -- Percentiles
    pr.overall_percentile,
    pr.finishing_percentile,
    pr.involvement_percentile,
    pr.carrying_percentile,
    pr.physical_percentile,
    pr.pressing_percentile,
    -- Per-90 stats
    pr.goals_per90,
    pr.xg_per90,
    pr.xa_per90
FROM peer_ratings pr
JOIN players p ON p.id = pr.player_id
JOIN leagues l ON l.id = pr.league_id;

-- View: Leaderboard for specific league+season+position
-- Usage: SELECT * FROM league_season_leaderboard 
--        WHERE league_id = X AND season = 'Y' AND position = 'ST'
CREATE OR REPLACE VIEW league_season_leaderboard AS
SELECT 
    pr.player_id,
    pr.league_id,
    pr.season,
    pr.position,
    p.name as player_name,
    -- Primary team
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

-- View: Player's teams across all leagues+seasons
-- Usage: SELECT * FROM player_teams_by_season WHERE player_id = X
CREATE OR REPLACE VIEW player_teams_by_season AS
SELECT 
    mps.player_id,
    m.league_id,
    m.season,
    l.name as league_name,
    t.id as team_id,
    t.name as team_name,
    COUNT(*) as matches,
    SUM(mps.minutes_played) as minutes,
    MAX(m.date) as last_match_date
FROM match_player_stats mps
JOIN matches m ON m.id = mps.match_id
JOIN teams t ON t.id = mps.team_id
JOIN leagues l ON l.id = m.league_id
GROUP BY mps.player_id, m.league_id, m.season, l.name, t.id, t.name
ORDER BY m.season DESC, m.league_id;

-- View: Available leagues+seasons with player counts
-- Usage: SELECT * FROM available_seasons ORDER BY season DESC
CREATE OR REPLACE VIEW available_seasons AS
SELECT 
    l.id as league_id,
    l.name as league_name,
    m.season,
    COUNT(DISTINCT m.id) as match_count,
    COUNT(DISTINCT mps.player_id) as player_count,
    MIN(m.date) as season_start,
    MAX(m.date) as season_end
FROM matches m
JOIN leagues l ON l.id = m.league_id
LEFT JOIN match_player_stats mps ON mps.match_id = m.id
GROUP BY l.id, l.name, m.season
ORDER BY m.season DESC, l.name;

-- Comments for documentation
COMMENT ON VIEW player_league_season_profile IS 
'Player ratings with team context for UI filtering by (league_id, season). Returns one row per player per league+season.';

COMMENT ON VIEW league_season_leaderboard IS 
'Leaderboard view for filtering by (league_id, season, position). Includes team and key metrics.';

COMMENT ON VIEW player_teams_by_season IS 
'Shows all teams a player appeared for in each league+season. Useful for showing multi-club players.';

COMMENT ON VIEW available_seasons IS 
'Lists all available (league, season) combinations with match and player counts for UI season dropdown.';