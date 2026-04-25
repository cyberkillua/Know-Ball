-- ============================================================
-- Migration 037: Per-match ball carry distance
--
-- Sofascore lineup stats expose totalBallCarriesDistance and
-- totalProgressiveBallCarriesDistance per player per match, but
-- they weren't persisted. Needed for CM/CAM carrying dimension
-- and percentile rankings (progressive carries distance).
-- ============================================================

ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_ball_carries_distance NUMERIC(8,2) DEFAULT 0;
ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS total_progressive_ball_carries_distance NUMERIC(8,2) DEFAULT 0;
