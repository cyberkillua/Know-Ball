-- Store config-driven style fingerprints for player-league-season peer ratings.

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS style_profile JSONB,
  ADD COLUMN IF NOT EXISTS style_confidence DECIMAL(5,2);

CREATE INDEX IF NOT EXISTS idx_peer_ratings_style_profile_gin
  ON public.peer_ratings USING GIN (style_profile);
