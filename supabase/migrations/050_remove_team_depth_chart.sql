-- Remove the abandoned depth-chart experiment and its inferred position data.
DROP TABLE IF EXISTS team_position_quality;

ALTER TABLE team_style_profiles
  DROP COLUMN IF EXISTS formation;

DROP INDEX IF EXISTS idx_mps_position_played;

ALTER TABLE match_player_stats
  DROP COLUMN IF EXISTS position_played;
