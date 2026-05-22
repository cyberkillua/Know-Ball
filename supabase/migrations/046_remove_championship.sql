-- Remove Championship from the tracked league set and existing data.

DO $$
DECLARE
  championship_ids INTEGER[];
  championship_match_ids INTEGER[];
  championship_team_ids INTEGER[];
BEGIN
  SELECT ARRAY_AGG(id)
    INTO championship_ids
  FROM public.leagues
  WHERE fotmob_id = 48
     OR name = 'Championship';

  IF championship_ids IS NULL THEN
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id)
    INTO championship_match_ids
  FROM public.matches
  WHERE league_id = ANY(championship_ids);

  SELECT ARRAY_AGG(id)
    INTO championship_team_ids
  FROM public.teams
  WHERE league_id = ANY(championship_ids);

  IF championship_match_ids IS NOT NULL THEN
    DELETE FROM public.match_ratings
    WHERE match_id = ANY(championship_match_ids);

    DELETE FROM public.match_player_stats
    WHERE match_id = ANY(championship_match_ids);

    DELETE FROM public.match_team_stats
    WHERE match_id = ANY(championship_match_ids);

    DELETE FROM public.match_gk_stats
    WHERE match_id = ANY(championship_match_ids);

    DELETE FROM public.match_odds
    WHERE match_id = ANY(championship_match_ids);

    DELETE FROM public.shots
    WHERE match_id = ANY(championship_match_ids);

    DELETE FROM public.matches
    WHERE id = ANY(championship_match_ids);
  END IF;

  DELETE FROM public.peer_ratings
  WHERE league_id = ANY(championship_ids);

  IF to_regclass('public.cross_league_ratings') IS NOT NULL THEN
    DELETE FROM public.cross_league_ratings
    WHERE league_id = ANY(championship_ids);
  END IF;

  DELETE FROM public.league_standings
  WHERE league_id = ANY(championship_ids);

  IF to_regclass('public.player_season_sofascore') IS NOT NULL THEN
    DELETE FROM public.player_season_sofascore
    WHERE league_id = ANY(championship_ids);
  END IF;

  IF to_regclass('public.historical_backfill_progress') IS NOT NULL THEN
    DELETE FROM public.historical_backfill_progress
    WHERE league_id = ANY(championship_ids)
       OR fotmob_league_id = 48
       OR league_name = 'Championship';
  END IF;

  IF championship_team_ids IS NOT NULL THEN
    UPDATE public.teams t
    SET league_id = retained.league_id
    FROM (
      SELECT team_id, MIN(league_id) AS league_id
      FROM (
        SELECT home_team_id AS team_id, league_id
        FROM public.matches
        UNION ALL
        SELECT away_team_id AS team_id, league_id
        FROM public.matches
      ) remaining_matches
      WHERE team_id = ANY(championship_team_ids)
        AND league_id <> ALL(championship_ids)
      GROUP BY team_id
    ) retained
    WHERE t.id = retained.team_id;

    UPDATE public.players
    SET current_team_id = NULL
    WHERE current_team_id IN (
      SELECT id
      FROM public.teams
      WHERE id = ANY(championship_team_ids)
        AND league_id = ANY(championship_ids)
    );

    DELETE FROM public.teams
    WHERE id = ANY(championship_team_ids)
      AND league_id = ANY(championship_ids);
  END IF;

  DELETE FROM public.leagues
  WHERE id = ANY(championship_ids);
END $$;
