-- Add rated_minutes to peer_ratings
-- Tracks minutes played in matches rated under the player's profile position config
-- Used by the frontend to gate Peer comparison (requires 300+ rated mins)
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS rated_minutes INTEGER;
