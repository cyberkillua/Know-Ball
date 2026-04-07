-- Support multiple peer-rating views per player-season:
-- 1) dominant-position view (existing behavior)
-- 2) position-specific view using only minutes played in that peer group

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS peer_mode TEXT NOT NULL DEFAULT 'dominant',
  ADD COLUMN IF NOT EXISTS position_scope TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS xgot_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS xg_plus_xa_raw_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS possession_loss_rate_percentile INTEGER,
  ADD COLUMN IF NOT EXISTS fouls_committed_per90_percentile INTEGER;

UPDATE public.peer_ratings
SET peer_mode = COALESCE(peer_mode, 'dominant'),
    position_scope = COALESCE(position_scope, '');

ALTER TABLE public.peer_ratings
  DROP CONSTRAINT IF EXISTS peer_ratings_player_id_league_id_season_key;

ALTER TABLE public.peer_ratings
  ADD CONSTRAINT peer_ratings_player_league_season_mode_scope_key
  UNIQUE (player_id, league_id, season, peer_mode, position_scope);

CREATE INDEX IF NOT EXISTS idx_peer_ratings_lookup_mode
  ON public.peer_ratings (player_id, league_id, season, peer_mode, position_scope);
