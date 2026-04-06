-- Remove v6 legacy dimension columns from match_ratings.
-- v7 equivalents (chance_creation, team_function, duels, defensive) are the canonical columns.

ALTER TABLE public.match_ratings
  DROP COLUMN IF EXISTS involvement_raw,
  DROP COLUMN IF EXISTS involvement_norm,
  DROP COLUMN IF EXISTS physical_raw,
  DROP COLUMN IF EXISTS physical_norm,
  DROP COLUMN IF EXISTS pressing_raw,
  DROP COLUMN IF EXISTS pressing_norm,
  DROP COLUMN IF EXISTS creation_raw,
  DROP COLUMN IF EXISTS creation_norm;
