DROP INDEX IF EXISTS idx_mps_position;

ALTER TABLE public.match_player_stats
  DROP COLUMN IF EXISTS position_played;
