-- Store the season-level CM role inferred from the player's strongest signals.
-- Possible values are controller, ball_winner, carrier, creator, box_crasher.

ALTER TABLE public.peer_ratings
  ADD COLUMN IF NOT EXISTS cm_archetype TEXT;
