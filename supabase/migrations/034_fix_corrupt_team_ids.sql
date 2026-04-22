-- Fix corrupt match_player_stats.team_id records caused by player.get("teamId")
-- returning None in Sofascore API responses, which caused all such players to be
-- assigned to the home team via the fallback in _process_match.
--
-- We can identify records where team_id is neither home nor away team.
-- We CANNOT auto-correct these without re-scraping (we don't know which side the
-- player was on), so this migration only fixes current_team_id in the players table
-- using the most recent VALID match_player_stats record for each player.
--
-- Records where team_id equals home_team_id may still be wrong (player was on away
-- team but got mis-assigned). Those require a re-scrape to fix completely.

-- Fix players.current_team_id using most recent valid mps record
-- (valid = team_id matches home or away team of the match)
UPDATE players p
SET current_team_id = most_recent.team_id
FROM (
  SELECT DISTINCT ON (mps.player_id)
    mps.player_id,
    mps.team_id
  FROM match_player_stats mps
  JOIN matches m ON m.id = mps.match_id
  WHERE mps.team_id = m.home_team_id
     OR mps.team_id = m.away_team_id
  ORDER BY mps.player_id, m.date DESC
) most_recent
WHERE p.id = most_recent.player_id
  AND p.current_team_id IS DISTINCT FROM most_recent.team_id;
