-- Store richer, config-driven role/archetype output while keeping
-- role_archetype available for legacy UI and queries.

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS role_family TEXT,
  ADD COLUMN IF NOT EXISTS role_fit JSONB,
  ADD COLUMN IF NOT EXISTS role_confidence DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS role_evidence JSONB;

CREATE INDEX IF NOT EXISTS idx_peer_ratings_role_family
  ON public.peer_ratings (role_family);

CREATE INDEX IF NOT EXISTS idx_peer_ratings_role_fit_gin
  ON public.peer_ratings USING GIN (role_fit);
