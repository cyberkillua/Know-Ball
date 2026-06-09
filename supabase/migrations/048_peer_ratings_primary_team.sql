-- Persist each peer-rating row's primary club so the players-list queries no longer
-- recompute it from a full match_player_stats scan on every request.
-- The pipeline (pipeline/model/compute.py) already derives this via its
-- player_primary_team CTE; this column simply stores the result.
ALTER TABLE peer_ratings
  ADD COLUMN IF NOT EXISTS primary_team_id integer REFERENCES teams(id);

-- Supports getSimilarRoleProfiles: walk candidates in (role_confidence, model_score)
-- order and stop at the LIMIT instead of scanning + top-N sorting every candidate.
CREATE INDEX IF NOT EXISTS idx_peer_ratings_similar
  ON peer_ratings (position, role_confidence DESC NULLS LAST, model_score DESC NULLS LAST)
  WHERE peer_mode = 'dominant' AND position_scope = '' AND role_fit IS NOT NULL;
