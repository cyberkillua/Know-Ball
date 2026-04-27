-- Store the season-level display role inferred from each player's strongest
-- position-specific signals.

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS role_archetype TEXT;
