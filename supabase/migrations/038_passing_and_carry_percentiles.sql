-- ============================================================
-- Migration 038: Passing + carry distance percentile columns
--
-- Adds percentile columns driven by the new per-match carry
-- distance data (037) and the season-level sofascore table
-- (player_season_sofascore, migration 036).
--
-- Per-match-derived percentiles:
--   progressive_carries_distance_per90_percentile — from new
--     match_player_stats.total_progressive_ball_carries_distance
--   progressive_carries_distance_raw_percentile — season total
--   pass_value_normalized_percentile — avg of match-level
--     match_player_stats.pass_value_normalized across matches
--
-- Season-level percentiles (joined from player_season_sofascore):
--   accurate_final_third_passes_per90_percentile
--   accurate_final_third_passes_raw_percentile
--   pass_to_assist_per90_percentile
--   pass_to_assist_raw_percentile
-- ============================================================

ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS progressive_carries_distance_per90_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS progressive_carries_distance_raw_percentile   INTEGER,
  ADD COLUMN IF NOT EXISTS pass_value_normalized_percentile              INTEGER,
  ADD COLUMN IF NOT EXISTS accurate_final_third_passes_per90_percentile  INTEGER,
  ADD COLUMN IF NOT EXISTS accurate_final_third_passes_raw_percentile    INTEGER,
  ADD COLUMN IF NOT EXISTS pass_to_assist_per90_percentile               INTEGER,
  ADD COLUMN IF NOT EXISTS pass_to_assist_raw_percentile                 INTEGER;
