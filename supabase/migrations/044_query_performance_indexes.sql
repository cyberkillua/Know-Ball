-- Query performance indexes for player profiles, league lists, and scouting views.

CREATE INDEX IF NOT EXISTS idx_mps_player_match
  ON public.match_player_stats (player_id, match_id);

CREATE INDEX IF NOT EXISTS idx_mps_team_match
  ON public.match_player_stats (team_id, match_id);

CREATE INDEX IF NOT EXISTS idx_shots_player_match
  ON public.shots (player_id, match_id);

CREATE INDEX IF NOT EXISTS idx_match_ratings_player_match
  ON public.match_ratings (player_id, match_id);

CREATE INDEX IF NOT EXISTS idx_peer_ratings_league_season_score
  ON public.peer_ratings (
    league_id,
    season,
    peer_mode,
    position_scope,
    model_score DESC NULLS LAST
  );

CREATE INDEX IF NOT EXISTS idx_peer_ratings_pool_lookup
  ON public.peer_ratings (
    season,
    league_id,
    position,
    peer_mode,
    position_scope,
    rated_minutes
  );

CREATE INDEX IF NOT EXISTS idx_matches_season_league_matchday
  ON public.matches (season, league_id, matchday);
