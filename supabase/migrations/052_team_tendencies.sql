-- Evidence-backed style tendencies inferred from team metric percentiles.
ALTER TABLE team_style_profiles
  ADD COLUMN IF NOT EXISTS tendencies JSONB NOT NULL DEFAULT '[]'::jsonb;
